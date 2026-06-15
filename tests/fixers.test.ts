import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { applyOp, applyFixes, findingsWithFixes } from "../src/fixers/index.js";
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
});

const TEST_DIR = join(process.cwd(), "__test_fixers__");
const CONFIG = join(TEST_DIR, "openclaw.json");
const AGENT_DIR = join(TEST_DIR, "agent");
const MODELS = join(AGENT_DIR, "models.json");

function report(results: AuditResult[]): AuditReport {
  return {
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

  it("applies config + models fixes, writes backups, and counts changes", () => {
    const r = report([
      fix([{ target: "config", op: "arrayRemove", path: "agents.defaults.model.fallbacks", remove: ["p"] }]),
      fix([{ target: "config", op: "delete", path: "agents.defaults.thinkingDefault" }]),
      fix([{ target: "config", op: "arrayRemove", path: "agents.list.0.tools.deny", remove: ["group:x"] }]),
      fix([{ target: "models", op: "delete", path: "providers.openai-codex.api" }]),
    ]);

    const result = applyFixes(r, { configPath: CONFIG, agentDir: AGENT_DIR });

    expect(result.applied).toBe(4);
    expect(result.files).toHaveLength(2); // config + models both touched
    expect(existsSync(`${CONFIG}.pre-fix.bak`)).toBe(true);
    expect(existsSync(`${MODELS}.pre-fix.bak`)).toBe(true);

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
    applyFixes(r, { configPath: CONFIG, agentDir: AGENT_DIR });
    const cfg = JSON.parse(readFileSync(CONFIG, "utf-8"));
    // arrayRemove ran first → the aliased dup is gone, arrayReplace then no-ops.
    expect(cfg.agents.defaults.model.fallbacks).toEqual(["other"]);
    expect(cfg.agents.defaults.model.primary).toBe("canon/x");
  });

  it("dry-run writes nothing but still counts", () => {
    const r = report([
      fix([{ target: "config", op: "delete", path: "agents.defaults.thinkingDefault" }]),
    ]);
    const result = applyFixes(r, { configPath: CONFIG, agentDir: AGENT_DIR, dryRun: true });
    expect(result.applied).toBe(1);
    expect(result.dryRun).toBe(true);
    expect(existsSync(`${CONFIG}.pre-fix.bak`)).toBe(false);
    const cfg = JSON.parse(readFileSync(CONFIG, "utf-8"));
    expect(cfg.agents.defaults.thinkingDefault).toBe("bogus"); // unchanged on disk
  });

  it("applies 0 when the config is already clean (no backup written)", () => {
    writeFileSync(CONFIG, JSON.stringify({ agents: { defaults: { model: { primary: "p", fallbacks: ["a"] } } } }));
    const r = report([
      fix([{ target: "config", op: "arrayRemove", path: "agents.defaults.model.fallbacks", remove: ["p"] }]),
    ]);
    const result = applyFixes(r, { configPath: CONFIG, agentDir: AGENT_DIR });
    expect(result.applied).toBe(0);
    expect(result.files).toHaveLength(0);
    expect(existsSync(`${CONFIG}.pre-fix.bak`)).toBe(false);
  });

  it("skips models ops when models.json is absent (no crash)", () => {
    rmSync(MODELS);
    const r = report([
      fix([{ target: "models", op: "delete", path: "providers.openai-codex.api" }]),
    ]);
    const result = applyFixes(r, { configPath: CONFIG, agentDir: AGENT_DIR });
    expect(result.applied).toBe(0);
    expect(() => applyFixes(r, { configPath: CONFIG, agentDir: AGENT_DIR })).not.toThrow();
  });

  it("ignores findings without an apply payload", () => {
    const r = report([
      { category: "X", check: "x", status: "warn", message: "m", autoFixable: true },
      { category: "Y", check: "y", status: "info", message: "m" },
    ]);
    expect(findingsWithFixes(r)).toHaveLength(0);
    const result = applyFixes(r, { configPath: CONFIG, agentDir: AGENT_DIR });
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1); // the autoFixable-without-payload one
  });
});
