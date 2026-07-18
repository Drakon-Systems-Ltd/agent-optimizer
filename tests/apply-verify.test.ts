import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { countFails, verifyConfigFile } from "../src/utils/apply-verify.js";

const DIR = join(process.cwd(), "__test_apply_verify__");
const CFG = join(DIR, "openclaw.json");

// A valid primary is REQUIRED in any config meant to exercise downstream checks:
// model-config early-returns on missing model.primary, masking every other check.
const P = { primary: "anthropic/claude-opus-4-8", fallbacks: ["openai/gpt-5.6"] };

function write(config: unknown): void {
  writeFileSync(CFG, JSON.stringify(config));
}

beforeEach(() => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
});

afterEach(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe("verifyConfigFile", () => {
  it("passes a clean config against a zero baseline", () => {
    write({ agents: { defaults: { model: P, contextTokens: 200000 } } });
    const r = verifyConfigFile(CFG, { baselineFails: 0 });
    expect(r.ok).toBe(true);
    expect(r.fails).toBe(0);
    expect(r.reasons).toEqual([]);
  });

  it("fails and reports a parse error when the config is unparseable", () => {
    writeFileSync(CFG, '{"agents": ');
    const r = verifyConfigFile(CFG, { baselineFails: 0 });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain("parse");
    expect(r.fails).toBe(Infinity);
  });

  it("fails with an infinite count when the file is missing", () => {
    const r = verifyConfigFile(join(DIR, "does-not-exist.json"), { baselineFails: 0 });
    expect(r.ok).toBe(false);
    expect(r.fails).toBe(Infinity);
  });

  it("fails when a mutation introduces new fail-equivalents above baseline 0", () => {
    // failEquiv is 2: a real thinkingDefault-value FAIL + the Unknown-keys WARN.
    write({ agents: { defaults: { model: P, totallyBogusKey: 1, thinkingDefault: "nope" } } });
    const r = verifyConfigFile(CFG, { baselineFails: 0 });
    expect(r.ok).toBe(false);
    expect(r.fails).toBe(2);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("trips on the unknown-keys warn alone (it counts as a fail)", () => {
    write({ agents: { defaults: { model: P, totallyBogusKey: 1 } } });
    const r = verifyConfigFile(CFG, { baselineFails: 0 });
    expect(r.ok).toBe(false);
    expect(r.fails).toBe(1);
  });

  it("tolerates pre-existing fails when the baseline already accounts for them", () => {
    write({ agents: { defaults: { model: P, thinkingDefault: "nope" } } });
    const b = countFails(CFG);
    expect(b).toBe(1);
    const r = verifyConfigFile(CFG, { baselineFails: b });
    expect(r.ok).toBe(true);
    expect(r.fails).toBe(1);
  });

  it("fails on a broken $include and names the missing fragment", () => {
    write({ $include: "./missing-fragment.json", agents: { defaults: { model: P } } });
    const r = verifyConfigFile(CFG, { baselineFails: 0 });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((reason) => reason.includes("missing-fragment.json"))).toBe(true);
  });
});

describe("countFails", () => {
  it("counts fail-equivalents for a parseable config", () => {
    write({ agents: { defaults: { model: P, thinkingDefault: "nope" } } });
    expect(countFails(CFG)).toBe(1);
  });

  it("returns a non-finite count for an unparseable config", () => {
    writeFileSync(CFG, '{"agents": ');
    expect(Number.isFinite(countFails(CFG))).toBe(false);
    expect(countFails(CFG)).toBe(Infinity);
  });
});
