import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { applyOp, applyFixes, findingsWithFixes } from "../src/fixers/index.js";
import { listBackups } from "../src/utils/backups.js";
import { ApplyRolledBackError } from "../src/utils/transactional.js";
import type { AuditReport, AuditResult, FixOperation } from "../src/types.js";

describe("applyOp", () => {
  it("set changes a scalar and reports the change", () => {
    const root: Record<string, unknown> = { a: { b: "old" } };
    expect(applyOp(root, { target: "config", op: "set", path: "a.b", value: "new" })).toBe(true);
    expect((root.a as Record<string, unknown>).b).toBe("new");
  });

  it("set is a no-op when the value already matches", () => {
    const root: Record<string, unknown> = { a: { b: "x" } };
    expect(applyOp(root, { target: "config", op: "set", path: "a.b", value: "x" })).toBe(false);
  });

  it("set on an array index uses numeric path segment", () => {
    const root: Record<string, unknown> = { arr: ["a", "b", "c"] };
    expect(applyOp(root, { target: "config", op: "set", path: "arr.1", value: "B" })).toBe(true);
    expect(root.arr).toEqual(["a", "B", "c"]);
  });

  it("delete removes an existing key", () => {
    const root: Record<string, unknown> = { a: { b: 1, c: 2 } };
    expect(applyOp(root, { target: "config", op: "delete", path: "a.b" })).toBe(true);
    expect(root.a).toEqual({ c: 2 });
  });

  it("delete is a no-op when the key is absent", () => {
    const root: Record<string, unknown> = { a: {} };
    expect(applyOp(root, { target: "config", op: "delete", path: "a.b" })).toBe(false);
  });

  it("arrayRemove drops matching items", () => {
    const root: Record<string, unknown> = { a: { list: ["x", "y", "x", "z"] } };
    expect(applyOp(root, { target: "config", op: "arrayRemove", path: "a.list", remove: ["x"] })).toBe(true);
    expect((root.a as Record<string, unknown>).list).toEqual(["y", "z"]);
  });

  it("arrayRemove is a no-op when nothing matches", () => {
    const root: Record<string, unknown> = { a: { list: ["x"] } };
    expect(applyOp(root, { target: "config", op: "arrayRemove", path: "a.list", remove: ["q"] })).toBe(false);
  });

  it("arrayReplace swaps matching items by value", () => {
    const root: Record<string, unknown> = { a: { list: ["x", "y", "x"] } };
    expect(applyOp(root, { target: "config", op: "arrayReplace", path: "a.list", match: "x", value: "X" })).toBe(true);
    expect((root.a as Record<string, unknown>).list).toEqual(["X", "y", "X"]);
  });

  it("arrayReplace is a no-op when nothing matches", () => {
    const root: Record<string, unknown> = { a: { list: ["y"] } };
    expect(applyOp(root, { target: "config", op: "arrayReplace", path: "a.list", match: "x", value: "X" })).toBe(false);
  });

  it("returns false for a path whose parent does not exist", () => {
    const root: Record<string, unknown> = {};
    expect(applyOp(root, { target: "config", op: "set", path: "a.b.c", value: 1 })).toBe(false);
  });

  it("refuses prototype-polluting and array-truncating keys", () => {
    const root: Record<string, unknown> = { a: { x: 1 }, arr: ["a", "b", "c"] };
    expect(applyOp(root, { target: "config", op: "set", path: "a.__proto__.polluted", value: "y" })).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(applyOp(root, { target: "config", op: "set", path: "a.constructor", value: "y" })).toBe(false);
    expect(applyOp(root, { target: "config", op: "set", path: "arr.length", value: 1 })).toBe(false);
    expect(root.arr).toEqual(["a", "b", "c"]);
  });

  it("delete does not count inherited prototype properties as a change", () => {
    const root: Record<string, unknown> = { a: {} };
    expect(applyOp(root, { target: "config", op: "delete", path: "a.toString" })).toBe(false);
  });

  it("delete refuses array indices", () => {
    const root: Record<string, unknown> = { arr: ["a", "b"] };
    expect(applyOp(root, { target: "config", op: "delete", path: "arr.0" })).toBe(false);
    expect(root.arr).toEqual(["a", "b"]);
  });
});

const TEST_DIR = join(process.cwd(), "__test_fixers__");
const CONFIG = join(TEST_DIR, "openclaw.json");
const AGENT_DIR = join(TEST_DIR, "agent");
const MODELS = join(AGENT_DIR, "models.json");
// Hermetic backup store — lives under TEST_DIR so it (and the derived apply.lock)
// is torn down with everything else; nothing ever touches the real ~/.agent-optimizer.
const STORE = join(TEST_DIR, "store");

function report(results: AuditResult[]): AuditReport {
  return {
    schemaVersion: 1,
    timestamp: "t",
    host: "h",
    systems: [],
    openclawVersion: "2026.6.6",
    results,
    summary: { total: results.length, pass: 0, warn: 0, fail: 0 },
  };
}

function fix(apply: FixOperation[]): AuditResult {
  return { category: "X", check: "x", status: "warn", message: "m", autoFixable: true, apply };
}

describe("applyFixes", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(AGENT_DIR, { recursive: true });
    writeFileSync(
      CONFIG,
      JSON.stringify({
        agents: {
          defaults: { model: { primary: "p", fallbacks: ["a", "p"] }, thinkingDefault: "bogus" },
          list: [{ tools: { alsoAllow: ["group:x"], deny: ["group:x", "group:y"] } }],
        },
      }),
    );
    writeFileSync(MODELS, JSON.stringify({ providers: { "openai-codex": { api: "openai-responses", baseUrl: "https://api.openai.com/v1" } } }));
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("applies config + models fixes via the store, returns a backupId, and counts changes", () => {
    const r = report([
      fix([{ target: "config", op: "arrayRemove", path: "agents.defaults.model.fallbacks", remove: ["p"] }]),
      fix([{ target: "config", op: "delete", path: "agents.defaults.thinkingDefault" }]),
      fix([{ target: "config", op: "arrayRemove", path: "agents.list.0.tools.deny", remove: ["group:x"] }]),
      fix([{ target: "models", op: "delete", path: "providers.openai-codex.api" }]),
    ]);

    const result = applyFixes(r, { configPath: CONFIG, agentDir: AGENT_DIR, backupsDir: STORE });

    expect(result.applied).toBe(4);
    expect(result.files).toHaveLength(2); // config + models both touched
    expect(result.backupId).toBeTruthy();
    // The store holds ONE generation snapshotting both touched files; no sidecars.
    const gens = listBackups(STORE);
    expect(gens).toHaveLength(1);
    expect(gens[0].id).toBe(result.backupId);
    expect(gens[0].files.sort()).toEqual(["models.json", "openclaw.json"]);
    expect(existsSync(`${CONFIG}.pre-fix.bak`)).toBe(false);
    expect(existsSync(`${MODELS}.pre-fix.bak`)).toBe(false);

    const cfg = JSON.parse(readFileSync(CONFIG, "utf-8"));
    expect(cfg.agents.defaults.model.fallbacks).toEqual(["a"]);
    expect(cfg.agents.defaults.thinkingDefault).toBeUndefined();
    expect(cfg.agents.list[0].tools.deny).toEqual(["group:y"]);
    const models = JSON.parse(readFileSync(MODELS, "utf-8"));
    expect(models.providers["openai-codex"].api).toBeUndefined();
    expect(models.providers["openai-codex"].baseUrl).toBe("https://api.openai.com/v1"); // untouched
  });

  it("orders arrayRemove before arrayReplace on the same array (dup + alias)", () => {
    // fallbacks contains the primary alias twice-over: it's both a duplicate of
    // primary AND a legacy alias. Removal must win so we don't re-introduce a dup.
    writeFileSync(CONFIG, JSON.stringify({ agents: { defaults: { model: { primary: "legacy/alias", fallbacks: ["other", "legacy/alias"] } } } }));
    const r = report([
      fix([{ target: "config", op: "arrayReplace", path: "agents.defaults.model.fallbacks", match: "legacy/alias", value: "canon/x" }]),
      fix([{ target: "config", op: "arrayRemove", path: "agents.defaults.model.fallbacks", remove: ["legacy/alias"] }]),
      fix([{ target: "config", op: "set", path: "agents.defaults.model.primary", value: "canon/x" }]),
    ]);
    applyFixes(r, { configPath: CONFIG, agentDir: AGENT_DIR, backupsDir: STORE });
    const cfg = JSON.parse(readFileSync(CONFIG, "utf-8"));
    // arrayRemove ran first → the aliased dup is gone, arrayReplace then no-ops.
    expect(cfg.agents.defaults.model.fallbacks).toEqual(["other"]);
    expect(cfg.agents.defaults.model.primary).toBe("canon/x");
  });

  it("dry-run writes nothing, takes no backup, but still counts", () => {
    const r = report([
      fix([{ target: "config", op: "delete", path: "agents.defaults.thinkingDefault" }]),
    ]);
    const result = applyFixes(r, { configPath: CONFIG, agentDir: AGENT_DIR, dryRun: true, backupsDir: STORE });
    expect(result.applied).toBe(1);
    expect(result.dryRun).toBe(true);
    expect(result.backupId).toBeUndefined();
    expect(listBackups(STORE)).toHaveLength(0);
    const cfg = JSON.parse(readFileSync(CONFIG, "utf-8"));
    expect(cfg.agents.defaults.thinkingDefault).toBe("bogus"); // unchanged on disk
  });

  it("applies 0 when the config is already clean (no write, no backup)", () => {
    writeFileSync(CONFIG, JSON.stringify({ agents: { defaults: { model: { primary: "p", fallbacks: ["a"] } } } }));
    const r = report([
      fix([{ target: "config", op: "arrayRemove", path: "agents.defaults.model.fallbacks", remove: ["p"] }]),
    ]);
    const result = applyFixes(r, { configPath: CONFIG, agentDir: AGENT_DIR, backupsDir: STORE });
    expect(result.applied).toBe(0);
    expect(result.files).toHaveLength(0);
    expect(result.backupId).toBeUndefined();
    expect(listBackups(STORE)).toHaveLength(0);
  });

  it("skips models ops when models.json is absent (no crash, no backup)", () => {
    rmSync(MODELS);
    const r = report([
      fix([{ target: "models", op: "delete", path: "providers.openai-codex.api" }]),
    ]);
    const result = applyFixes(r, { configPath: CONFIG, agentDir: AGENT_DIR, backupsDir: STORE });
    expect(result.applied).toBe(0);
    expect(result.backupId).toBeUndefined();
    expect(listBackups(STORE)).toHaveLength(0);
    expect(() => applyFixes(r, { configPath: CONFIG, agentDir: AGENT_DIR, backupsDir: STORE })).not.toThrow();
  });

  it("auto-rolls back (and throws) when a fix would break the config", () => {
    // Start from a clean, valid config so the baseline is fail-free.
    const valid = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-opus-4-8", fallbacks: ["openai/gpt-5.6"] },
          contextTokens: 1000000,
        },
      },
    };
    writeFileSync(CONFIG, JSON.stringify(valid));
    const original = readFileSync(CONFIG, "utf-8");
    // This "fix" INTRODUCES an invalid thinkingDefault → verify regresses → rollback.
    const r = report([
      fix([{ target: "config", op: "set", path: "agents.defaults.thinkingDefault", value: "nope" }]),
    ]);
    expect(() =>
      applyFixes(r, { configPath: CONFIG, agentDir: AGENT_DIR, backupsDir: STORE })
    ).toThrow(ApplyRolledBackError);
    // The config was reverted to its exact pre-apply bytes.
    expect(readFileSync(CONFIG, "utf-8")).toBe(original);
  });

  it("leaves a temp file behavior clean (atomic write replaces, no .tmp left)", () => {
    const r = report([fix([{ target: "config", op: "delete", path: "agents.defaults.thinkingDefault" }])]);
    applyFixes(r, { configPath: CONFIG, agentDir: AGENT_DIR, backupsDir: STORE });
    const leftover = readdirSync(TEST_DIR).filter((f) => f.includes(".tmp-"));
    expect(leftover).toHaveLength(0);
  });

  it("ignores findings without an apply payload", () => {
    const r = report([
      { category: "X", check: "x", status: "warn", message: "m", autoFixable: true },
      { category: "Y", check: "y", status: "info", message: "m" },
    ]);
    expect(findingsWithFixes(r)).toHaveLength(0);
    const result = applyFixes(r, { configPath: CONFIG, agentDir: AGENT_DIR, backupsDir: STORE });
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1); // the autoFixable-without-payload one
  });
});
