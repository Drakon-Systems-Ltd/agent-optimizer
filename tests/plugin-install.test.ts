import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  lstatSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  installPlugin,
  resolveBundledPluginDir,
  PluginSourceError,
  PLUGIN_ID,
} from "../src/plugin-install.js";
import { listBackups } from "../src/utils/backups.js";

// Everything hermetic under a unique temp root; nothing touches ~/.openclaw or
// ~/.agent-optimizer.
let ROOT: string;
let SRC: string; // the "bundled plugin" source dir
let EXT: string; // the extensions dir
let STORE: string; // injected backups store for the transactional --enable

// A config with a real model.primary (so the verifier's baseline is clean and
// finite) and a NON-EMPTY allowlist (so enabling must APPEND, not no-op).
const VALID_CFG = {
  agents: {
    defaults: {
      model: { primary: "anthropic/claude-opus-4-8", fallbacks: ["openai/gpt-5.6"] },
      contextTokens: 1000000,
    },
  },
  plugins: { allow: ["openai"] },
};

/** Lay down a complete, loadable bundled-plugin source (3 files + some noise that
 *  must NOT be copied). Returns the source dir. */
function writeBundledSource(dir: string): void {
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "openclaw.plugin.json"), JSON.stringify({ id: PLUGIN_ID, version: "0.13.0" }));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "plugin", main: "./dist/index.js" }));
  writeFileSync(join(dir, "dist", "index.js"), "// bundled entry\nexport default {};\n");
  // Noise that must be excluded from the copy:
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), "// source — must not ship");
  mkdirSync(join(dir, "node_modules", "typebox"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "typebox", "index.js"), "// dep — must not ship");
}

beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), "plugin-install-"));
  SRC = join(ROOT, "bundled");
  EXT = join(ROOT, "extensions");
  STORE = join(ROOT, "store");
  writeBundledSource(SRC);
});
afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

describe("installPlugin — copy", () => {
  it("copies exactly the three loadable artifacts into <ext>/agent-optimizer/", () => {
    const result = installPlugin({ bundledPluginDir: SRC, extensionsDir: EXT });

    const dest = join(EXT, PLUGIN_ID);
    expect(result.installedTo).toBe(dest);
    expect(result.files).toEqual(["openclaw.plugin.json", "package.json", "dist/index.js"]);
    expect(result.enabled).toBe(false);
    expect(result.alreadyEnabled).toBe(false);

    expect(existsSync(join(dest, "openclaw.plugin.json"))).toBe(true);
    expect(existsSync(join(dest, "package.json"))).toBe(true);
    expect(existsSync(join(dest, "dist", "index.js"))).toBe(true);
    // content survived the copy
    expect(readFileSync(join(dest, "dist", "index.js"), "utf-8")).toContain("bundled entry");
    // src/ and node_modules/ were NOT copied
    expect(existsSync(join(dest, "src"))).toBe(false);
    expect(existsSync(join(dest, "node_modules"))).toBe(false);
  });

  it("does not touch any config when --enable is not passed (enableHint provided)", () => {
    const result = installPlugin({ bundledPluginDir: SRC, extensionsDir: EXT });
    expect(result.enabled).toBe(false);
    expect(result.backupId).toBeUndefined();
    expect(result.enableHint).toContain("plugins.allow");
  });

  it("overwrites a prior install cleanly (stale files removed)", () => {
    installPlugin({ bundledPluginDir: SRC, extensionsDir: EXT });
    const dest = join(EXT, PLUGIN_ID);
    writeFileSync(join(dest, "stale.txt"), "leftover from an older install");
    expect(existsSync(join(dest, "stale.txt"))).toBe(true);

    installPlugin({ bundledPluginDir: SRC, extensionsDir: EXT });
    expect(existsSync(join(dest, "stale.txt"))).toBe(false); // swept
    expect(existsSync(join(dest, "dist", "index.js"))).toBe(true); // fresh copy present
  });

  it("replaces a prior symlink install with a real directory (no write-through)", () => {
    const dest = join(EXT, PLUGIN_ID);
    mkdirSync(EXT, { recursive: true });
    // Simulate the manual `ln -s <repo> …/agent-optimizer` install.
    const linkTarget = join(ROOT, "repo-checkout");
    mkdirSync(linkTarget, { recursive: true });
    symlinkSync(linkTarget, dest);
    expect(lstatSync(dest).isSymbolicLink()).toBe(true);

    installPlugin({ bundledPluginDir: SRC, extensionsDir: EXT });

    expect(lstatSync(dest).isSymbolicLink()).toBe(false); // now a real dir
    expect(existsSync(join(dest, "dist", "index.js"))).toBe(true);
    // the symlink target repo was NOT written through
    expect(existsSync(join(linkTarget, "dist"))).toBe(false);
  });
});

describe("installPlugin — missing bundled dist", () => {
  it("throws a clear PluginSourceError naming dist/index.js", () => {
    rmSync(join(SRC, "dist"), { recursive: true, force: true }); // build never ran
    expect(() => installPlugin({ bundledPluginDir: SRC, extensionsDir: EXT })).toThrow(
      PluginSourceError
    );
    try {
      installPlugin({ bundledPluginDir: SRC, extensionsDir: EXT });
    } catch (e) {
      expect((e as Error).message).toMatch(/dist\/index\.js/);
      expect((e as Error).message).toMatch(/build/i);
    }
    // nothing was copied
    expect(existsSync(join(EXT, PLUGIN_ID))).toBe(false);
  });

  it("throws when the manifest is absent entirely", () => {
    rmSync(join(SRC, "openclaw.plugin.json"), { force: true });
    expect(() => installPlugin({ bundledPluginDir: SRC, extensionsDir: EXT })).toThrow(
      PluginSourceError
    );
  });
});

describe("installPlugin — --enable (transactional)", () => {
  function writeConfig(): string {
    const cfg = join(ROOT, "openclaw.json");
    writeFileSync(cfg, JSON.stringify(VALID_CFG, null, 2));
    return cfg;
  }

  it("adds agent-optimizer to plugins.allow through the transactional engine", () => {
    const cfg = writeConfig();
    const result = installPlugin({
      bundledPluginDir: SRC,
      extensionsDir: EXT,
      enable: true,
      configPath: cfg,
      backupsDir: STORE,
    });

    expect(result.enabled).toBe(true);
    expect(result.alreadyEnabled).toBe(false);
    expect(result.backupId).toBeTruthy();

    const written = JSON.parse(readFileSync(cfg, "utf-8"));
    expect(written.plugins.allow).toContain(PLUGIN_ID);
    expect(written.plugins.allow).toContain("openai"); // preserved, appended not replaced

    // a real backup generation was taken in the injected store
    const gens = listBackups(STORE);
    expect(gens.length).toBe(1);
    expect(gens[0].id).toBe(result.backupId);
  });

  it("is idempotent — a second --enable is a no-op with no new backup", () => {
    const cfg = writeConfig();
    const first = installPlugin({
      bundledPluginDir: SRC,
      extensionsDir: EXT,
      enable: true,
      configPath: cfg,
      backupsDir: STORE,
    });
    expect(first.alreadyEnabled).toBe(false);
    expect(first.backupId).toBeTruthy();

    const second = installPlugin({
      bundledPluginDir: SRC,
      extensionsDir: EXT,
      enable: true,
      configPath: cfg,
      backupsDir: STORE,
    });
    expect(second.enabled).toBe(true);
    expect(second.alreadyEnabled).toBe(true);
    expect(second.backupId).toBeUndefined();

    // allow still contains exactly one occurrence; no second backup was created
    const written = JSON.parse(readFileSync(cfg, "utf-8"));
    expect(written.plugins.allow.filter((p: string) => p === PLUGIN_ID)).toHaveLength(1);
    expect(listBackups(STORE).length).toBe(1);
  });

  it("treats an absent/empty allowlist as already-permitted (no write, no restrict)", () => {
    // No plugins.allow ⇒ unrestricted ⇒ the plugin already loads. Enabling must
    // NOT create allow: [agent-optimizer] (that would disable every other plugin).
    const cfg = join(ROOT, "openclaw.json");
    const unrestricted = { agents: VALID_CFG.agents };
    const bytesBefore = JSON.stringify(unrestricted, null, 2);
    writeFileSync(cfg, bytesBefore);

    const result = installPlugin({
      bundledPluginDir: SRC,
      extensionsDir: EXT,
      enable: true,
      configPath: cfg,
      backupsDir: STORE,
    });

    expect(result.enabled).toBe(true);
    expect(result.alreadyEnabled).toBe(true);
    expect(result.backupId).toBeUndefined();
    expect(readFileSync(cfg, "utf-8")).toBe(bytesBefore); // byte-for-byte untouched
    expect(existsSync(STORE)).toBe(false); // no backup store created at all
  });

  it("errors clearly (and still copies) when --enable targets a missing config", () => {
    const missing = join(ROOT, "does-not-exist.json");
    expect(() =>
      installPlugin({
        bundledPluginDir: SRC,
        extensionsDir: EXT,
        enable: true,
        configPath: missing,
        backupsDir: STORE,
      })
    ).toThrow(PluginSourceError);
    // the copy happened before the enable attempt
    expect(existsSync(join(EXT, PLUGIN_ID, "dist", "index.js"))).toBe(true);
  });
});

describe("resolveBundledPluginDir", () => {
  it("resolves the sibling openclaw-plugin one level up from the CLI dir", () => {
    // Layout: <root>/dist/cli.js  +  <root>/openclaw-plugin/openclaw.plugin.json
    const pkgRoot = join(ROOT, "pkg");
    mkdirSync(join(pkgRoot, "dist"), { recursive: true });
    mkdirSync(join(pkgRoot, "openclaw-plugin"), { recursive: true });
    writeFileSync(join(pkgRoot, "openclaw-plugin", "openclaw.plugin.json"), "{}");

    const resolved = resolveBundledPluginDir(join(pkgRoot, "dist"));
    expect(resolved).toBe(join(pkgRoot, "openclaw-plugin"));
  });

  it("returns the primary candidate even when nothing is found (caller reports it)", () => {
    const cliDir = join(ROOT, "nowhere", "dist");
    mkdirSync(cliDir, { recursive: true });
    const resolved = resolveBundledPluginDir(cliDir);
    expect(resolved).toBe(join(ROOT, "nowhere", "openclaw-plugin"));
  });
});
