import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import JSON5 from "json5";
import { expandPath } from "./utils/config.js";
import { transactionalApply } from "./utils/transactional.js";

/**
 * Install the bundled OpenClaw plugin into an extensions directory, and
 * (optionally) enable it by adding its id to `plugins.allow` in the OpenClaw
 * config — the enable path goes THROUGH the transactional apply engine (backup →
 * verify → auto-rollback), so even enabling is safe and dogfoods our own safety.
 *
 * The plugin's built `dist/index.js` bundles TypeBox and externalizes `openclaw/*`
 * (resolved against the host OpenClaw install at load), so a directory of just
 * { openclaw.plugin.json, package.json, dist/index.js } is fully loadable with no
 * node_modules. We copy exactly those three files — never src/ or node_modules.
 */

export const PLUGIN_ID = "agent-optimizer";

/** The three artifacts a loadable install needs. dist/index.js last so a missing
 *  build is the final (and most actionable) validation failure. */
const PLUGIN_FILES = [
  "openclaw.plugin.json",
  "package.json",
  join("dist", "index.js"),
] as const;

/** The bundled plugin source is unusable — most commonly its `dist/index.js`
 *  hasn't been built. The CLI turns this into a clear "build it" message rather
 *  than copying a broken plugin. */
export class PluginSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginSourceError";
  }
}

export interface InstallPluginOptions {
  /** Directory holding the bundled plugin ({ openclaw.plugin.json, package.json,
   *  dist/index.js }). The CLI resolves this relative to the running binary via
   *  resolveBundledPluginDir(); tests inject a temp dir. */
  bundledPluginDir: string;
  /** Extensions root; the plugin lands in <extensionsDir>/agent-optimizer/.
   *  Default: ~/.openclaw/extensions. Honors a leading ~. */
  extensionsDir?: string;
  /** When true, also add the plugin id to plugins.allow in `configPath`,
   *  transactionally. When false (default) the config is never touched. */
  enable?: boolean;
  /** Path to openclaw.json — only READ/WRITTEN when enable is true.
   *  Default: ~/.openclaw/openclaw.json. */
  configPath?: string;
  /** Test-only: injected backups store for the transactional enable (so tests
   *  don't touch the real ~/.agent-optimizer/backups). */
  backupsDir?: string;
  /** Test-only: injected lock dir for the transactional enable. */
  lockDir?: string;
}

export interface InstallPluginResult {
  /** Absolute directory the three files were copied into. */
  installedTo: string;
  /** Relative paths copied (posix-style), e.g. ["openclaw.plugin.json", …]. */
  files: string[];
  /** True once the plugin is enabled in the config (enable path only — always
   *  false when enable was not requested). */
  enabled: boolean;
  /** enable path: true when plugins.allow already permitted it (no write made). */
  alreadyEnabled: boolean;
  /** enable path: the transactional backup id, present only when a write was made. */
  backupId?: string;
  /** Human instruction for turning the plugin on (used by the default, no-enable
   *  path). Always populated so the CLI can render it. */
  enableHint: string;
  /** The config path targeted by an enable (expanded), for the CLI's output. */
  configPath?: string;
}

const DEFAULT_EXTENSIONS_DIR = "~/.openclaw/extensions";
const DEFAULT_CONFIG_PATH = "~/.openclaw/openclaw.json";

const ENABLE_HINT =
  `Add "${PLUGIN_ID}" to plugins.allow in your openclaw config and restart the gateway ` +
  `(systemctl --user restart openclaw-gateway). Or run: agent-optimizer plugin install --enable`;

/**
 * Resolve the bundled plugin directory from the directory of the running CLI
 * file. The compiled binary is <pkgroot>/dist/cli.js and the plugin is at
 * <pkgroot>/openclaw-plugin; in dev the CLI runs from <repo>/src/cli.ts and the
 * plugin is at <repo>/openclaw-plugin — both are exactly one level below the
 * package root, so `../openclaw-plugin` covers both. A deeper fallback is tried
 * in case of an unusual build layout. Returns the first candidate whose manifest
 * exists, else the primary candidate (installPlugin then reports it clearly).
 */
export function resolveBundledPluginDir(cliDir: string): string {
  const candidates = [
    join(cliDir, "..", "openclaw-plugin"),
    join(cliDir, "..", "..", "openclaw-plugin"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "openclaw.plugin.json"))) return dir;
  }
  return candidates[0];
}

/** Assert the bundled source has all three files; throw PluginSourceError with an
 *  actionable message (build hint for a missing dist) otherwise. */
function assertBundledSource(bundledPluginDir: string): void {
  if (!existsSync(join(bundledPluginDir, "openclaw.plugin.json"))) {
    throw new PluginSourceError(
      `Bundled plugin not found at ${bundledPluginDir} (no openclaw.plugin.json). This looks like a broken install.`
    );
  }
  if (!existsSync(join(bundledPluginDir, "package.json"))) {
    throw new PluginSourceError(
      `Bundled plugin at ${bundledPluginDir} is missing package.json.`
    );
  }
  if (!existsSync(join(bundledPluginDir, "dist", "index.js"))) {
    throw new PluginSourceError(
      `Bundled plugin at ${bundledPluginDir} has no built dist/index.js. ` +
        `Build it first: (cd openclaw-plugin && npm install && npm run build).`
    );
  }
}

/** Copy the three artifacts into <extensionsDir>/agent-optimizer/, replacing any
 *  prior install (a real dir OR a symlink from the manual `ln -s` flow) cleanly. */
function copyPlugin(bundledPluginDir: string, extensionsDir: string): string {
  const destDir = join(expandPath(extensionsDir), PLUGIN_ID);

  // Clear whatever is there. rmSync on a symlink removes the LINK, not its
  // target, so a prior `ln -s <repo> …/agent-optimizer` install is replaced by a
  // real directory rather than us writing through the link into the repo.
  if (existsSync(destDir) || isSymlink(destDir)) {
    rmSync(destDir, { recursive: true, force: true });
  }
  mkdirSync(join(destDir, "dist"), { recursive: true });
  for (const rel of PLUGIN_FILES) {
    copyFileSync(join(bundledPluginDir, rel), join(destDir, rel));
  }
  return destDir;
}

/** lstat-based symlink check that never throws for a missing path. */
function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Parse a config file's raw bytes, tolerating JSON5 (comments / trailing commas
 *  / unquoted keys), exactly as OpenClaw and our loader do. Does NOT resolve
 *  $include — the enable edit stays surgical to the top-level file. */
function parseConfigRaw(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = JSON5.parse(raw);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("openclaw config is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Is the plugin already permitted by the allowlist? Mirrors OpenClaw's own gate
 * (src/cli/plugins-cli.runtime.ts): an allowlist that is absent OR empty is
 * "unrestricted" — every plugin loads — so the plugin is already allowed and we
 * must NOT create `allow: ["agent-optimizer"]` (that would newly RESTRICT every
 * other plugin). We only append when `allow` is a non-empty array lacking the id.
 */
function isAllowedByAllowlist(config: Record<string, unknown>): boolean {
  const plugins = config.plugins;
  const allow =
    plugins && typeof plugins === "object"
      ? (plugins as Record<string, unknown>).allow
      : undefined;
  if (!Array.isArray(allow) || allow.length === 0) return true; // unrestricted
  return allow.includes(PLUGIN_ID);
}

/** Add PLUGIN_ID to a non-empty plugins.allow in-place on a parsed config. */
function appendToAllowlist(config: Record<string, unknown>): void {
  const plugins = (config.plugins ?? {}) as Record<string, unknown>;
  const allow = Array.isArray(plugins.allow) ? (plugins.allow as unknown[]) : [];
  if (!allow.includes(PLUGIN_ID)) allow.push(PLUGIN_ID);
  plugins.allow = allow;
  config.plugins = plugins;
}

export function installPlugin(opts: InstallPluginOptions): InstallPluginResult {
  assertBundledSource(opts.bundledPluginDir);

  const installedTo = copyPlugin(
    opts.bundledPluginDir,
    opts.extensionsDir ?? DEFAULT_EXTENSIONS_DIR
  );
  const files = PLUGIN_FILES.map((f) => f.split("\\").join("/"));

  const base: InstallPluginResult = {
    installedTo,
    files,
    enabled: false,
    alreadyEnabled: false,
    enableHint: ENABLE_HINT,
  };

  if (!opts.enable) return base;

  // --- enable path: touch the real config, transactionally ---
  const target = expandPath(opts.configPath ?? DEFAULT_CONFIG_PATH);
  base.configPath = target;

  if (!existsSync(target)) {
    throw new PluginSourceError(
      `Cannot enable: openclaw config not found at ${target}. Install the plugin without --enable, then add "${PLUGIN_ID}" to plugins.allow manually.`
    );
  }

  // Idempotency: if the allowlist already permits the plugin, make no write at
  // all (no backup, no transaction) — a clean no-op.
  const current = parseConfigRaw(readFileSync(target, "utf-8"));
  if (isAllowedByAllowlist(current)) {
    return { ...base, enabled: true, alreadyEnabled: true };
  }

  const result = transactionalApply({
    files: [target],
    backupsDir: opts.backupsDir,
    lockDir: opts.lockDir,
    mutate: () => {
      // Re-read inside the mutation so we edit the exact snapshotted bytes, then
      // write atomically (temp + rename) — a reading gateway never sees a
      // half-written config; the store backup wraps this for verify/rollback.
      const config = parseConfigRaw(readFileSync(target, "utf-8"));
      appendToAllowlist(config);
      const tmp = `${target}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
      renameSync(tmp, target);
    },
  });

  return { ...base, enabled: true, alreadyEnabled: false, backupId: result.backupId };
}
