import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname, isAbsolute, normalize } from "path";
import { homedir } from "os";
import { createRequire } from "module";
import JSON5 from "json5";
import type { OpenClawConfig, AuthProfiles } from "../types.js";

export function expandPath(p: string): string {
  return p.replace(/^~/, homedir());
}

// OpenClaw parses config as JSON5 (comments, trailing commas, unquoted keys).
// Try strict JSON first — it's faster and covers machine-written files.
function parseJsonCompat<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return JSON5.parse(raw) as T;
  }
}

export function readJsonFile<T>(path: string): T | null {
  const resolved = expandPath(path);
  if (!existsSync(resolved)) return null;
  return parseJsonCompat<T>(readFileSync(resolved, "utf-8"));
}

// --- $include support (mirrors OpenClaw src/config/includes.ts semantics:
// value is a string or array of strings; an object with only $include is
// replaced by the included content; sibling keys deep-merge OVER it; array
// entries merge left-to-right; relative paths resolve against the including
// file's directory; depth capped; cycles rejected.) ---

const INCLUDE_KEY = "$include";
const MAX_INCLUDE_DEPTH = 10;

let configLoadIssues: string[] = [];

/** Non-fatal problems from the last loadConfig() call ($include files missing,
 * cycles, depth) — the audit should surface these, not crash on them. */
export function getConfigLoadIssues(): string[] {
  return configLoadIssues;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(a: unknown, b: unknown): unknown {
  if (!isPlainObject(a) || !isPlainObject(b)) return b;
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out;
}

function loadIncludeFile(includePath: string, baseDir: string, stack: string[]): unknown {
  const resolved = normalize(
    isAbsolute(includePath) ? includePath : resolve(baseDir, expandPath(includePath))
  );
  if (stack.includes(resolved)) {
    configLoadIssues.push(`Circular $include: ${[...stack, resolved].join(" -> ")}`);
    return {};
  }
  if (stack.length >= MAX_INCLUDE_DEPTH) {
    configLoadIssues.push(`$include depth limit (${MAX_INCLUDE_DEPTH}) exceeded at ${includePath}`);
    return {};
  }
  if (!existsSync(resolved)) {
    configLoadIssues.push(`$include file not found: ${includePath} (resolved to ${resolved}) — OpenClaw will fail to load this config`);
    return {};
  }
  try {
    const parsed = parseJsonCompat<unknown>(readFileSync(resolved, "utf-8"));
    return resolveIncludes(parsed, dirname(resolved), [...stack, resolved]);
  } catch (err) {
    configLoadIssues.push(`$include file unparseable: ${includePath} (${(err as Error).message})`);
    return {};
  }
}

function resolveIncludes(value: unknown, baseDir: string, stack: string[]): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveIncludes(v, baseDir, stack));
  if (!isPlainObject(value)) return value;

  if (!(INCLUDE_KEY in value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveIncludes(v, baseDir, stack);
    return out;
  }

  const includeValue = value[INCLUDE_KEY];
  const paths = typeof includeValue === "string"
    ? [includeValue]
    : Array.isArray(includeValue)
      ? includeValue.filter((p): p is string => typeof p === "string")
      : [];

  let included: unknown = {};
  for (const p of paths) {
    included = deepMerge(included, loadIncludeFile(p, baseDir, stack));
  }

  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === INCLUDE_KEY) continue;
    rest[k] = resolveIncludes(v, baseDir, stack);
  }
  if (Object.keys(rest).length === 0) return included;
  return deepMerge(included, rest);
}

export function loadConfig(configPath: string): OpenClawConfig | null {
  configLoadIssues = [];
  const resolved = expandPath(configPath);
  if (!existsSync(resolved)) return null;
  const parsed = parseJsonCompat<unknown>(readFileSync(resolved, "utf-8"));
  const withIncludes = resolveIncludes(parsed, dirname(resolved), [resolved]);
  return isPlainObject(withIncludes) ? (withIncludes as OpenClawConfig) : null;
}

export function loadAuthProfiles(agentDir: string): AuthProfiles | null {
  const dir = expandPath(agentDir);
  // OpenClaw 2026.6.6+ persists auth profiles in <agentDir>/openclaw-agent.sqlite
  // (table auth_profile_store, one JSON blob per store_key). The legacy
  // auth-profiles.json file is only left behind on unmigrated installs.
  return (
    readAuthStoreSqlite(resolve(dir, "openclaw-agent.sqlite")) ??
    readJsonFile<AuthProfiles>(resolve(dir, "auth-profiles.json"))
  );
}

function readAuthStoreSqlite(dbPath: string): AuthProfiles | null {
  if (!existsSync(dbPath)) return null;
  const originalEmitWarning = process.emitWarning;
  try {
    // node:sqlite needs Node 22.5+ and emits an ExperimentalWarning on load;
    // suppress just that warning so audit output stays clean.
    process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
      if (String(warning).includes("SQLite is an experimental feature")) return;
      return (originalEmitWarning as (...a: unknown[]) => void).call(process, warning, ...rest);
    }) as typeof process.emitWarning;
    const nodeRequire = createRequire(import.meta.url);
    const { DatabaseSync } = nodeRequire("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db
        .prepare("SELECT store_json FROM auth_profile_store WHERE store_key = 'primary'")
        .get() as { store_json?: unknown } | undefined;
      if (!row || typeof row.store_json !== "string") return null;
      const parsed = JSON.parse(row.store_json) as AuthProfiles;
      return parsed && typeof parsed === "object" && parsed.profiles ? parsed : null;
    } finally {
      db.close();
    }
  } catch {
    // Node <22.5 (no node:sqlite), locked/corrupt DB, or missing table —
    // fall back to the legacy JSON store rather than failing the audit.
    return null;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

export function loadModelsJson(agentDir: string): Record<string, unknown> | null {
  const path = resolve(expandPath(agentDir), "models.json");
  return readJsonFile<Record<string, unknown>>(path);
}

export function findAgentDir(config: OpenClawConfig): string {
  // Defensive: config is raw-parsed with no validation, so list[0] may be
  // null / a non-object from a hand-edited file.
  const first = Array.isArray(config.agents?.list) ? config.agents.list[0] : undefined;
  if (first && typeof first === "object" && first.agentDir) {
    return first.agentDir;
  }
  return "~/.openclaw/agents/main/agent";
}

export function findWorkspace(config: OpenClawConfig): string {
  const first = Array.isArray(config.agents?.list) ? config.agents.list[0] : undefined;
  if (first && typeof first === "object" && first.workspace) {
    return first.workspace;
  }
  return config.agents?.defaults?.workspace ?? "~/.openclaw/workspace";
}

/**
 * Detect OpenClaw version. Tries (in order):
 * 1. `openclaw --version` CLI output
 * 2. package.json in global npm install
 * Returns null if detection fails.
 */
export function detectOpenClawVersion(): string | null {
  // Try CLI
  try {
    const output = execSync("openclaw --version 2>/dev/null", {
      timeout: 5000,
      encoding: "utf-8",
    }).trim();
    // Output format varies: "2026.4.14" or "openclaw 2026.4.14"
    const match = output.match(/(\d{4}\.\d+\.\d+(?:-[\w.]+)?)/);
    if (match) return match[1];
  } catch {
    // CLI not available
  }

  // Try global npm package.json
  const candidates = [
    "/usr/lib/node_modules/openclaw/package.json",
    "/usr/local/lib/node_modules/openclaw/package.json",
    resolve(homedir(), ".npm-global/lib/node_modules/openclaw/package.json"),
    "/opt/homebrew/lib/node_modules/openclaw/package.json",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf-8"));
        if (pkg.version) return pkg.version;
      } catch {
        // Unreadable
      }
    }
  }

  return null;
}

/**
 * Parse a version string like "2026.4.14" into comparable parts.
 * Returns null if the version can't be parsed.
 */
export function parseVersion(version: string): { year: number; major: number; patch: number } | null {
  const match = version.match(/^(\d{4})\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    year: parseInt(match[1]),
    major: parseInt(match[2]),
    patch: parseInt(match[3]),
  };
}

/**
 * Returns true if `version` is older than `target`.
 */
export function isOlderThan(version: string, target: string): boolean {
  const v = parseVersion(version);
  const t = parseVersion(target);
  if (!v || !t) return false;
  if (v.year !== t.year) return v.year < t.year;
  if (v.major !== t.major) return v.major < t.major;
  return v.patch < t.patch;
}

export function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 0;
  const [, value, unit] = match;
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  return parseInt(value) * (multipliers[unit] ?? 0);
}
