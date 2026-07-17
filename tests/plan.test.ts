import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { buildPlan, savePlan, loadPlan, configHashOf } from "../src/optimizers/plan.js";

const DIR = join(process.cwd(), "__test_plan__");
const CFG = join(DIR, "openclaw.json");
const PLANS = join(DIR, "plans");

beforeEach(() => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(CFG, JSON.stringify({
    agents: { defaults: { contextTokens: 1000000, heartbeat: { every: "30m" } } },
  }));
});
afterEach(() => rmSync(DIR, { recursive: true, force: true }));

describe("plan module", () => {
  it("builds a plan with stable proposal ids and a config hash", () => {
    const plan = buildPlan(CFG, "balanced");
    expect(plan.schemaVersion).toBe(1);
    expect(plan.planId).toMatch(/^[a-f0-9]{12}$/);
    expect(plan.configHash).toBe(configHashOf(CFG));
    expect(plan.proposals.length).toBeGreaterThan(0);
    for (const p of plan.proposals) {
      // ids embed the tag verbatim; tags like runRetries-cap contain uppercase
      expect(p.id).toMatch(/^p\d+-[a-zA-Z-]+$/); // e.g. p1-context
      expect(p.risk).toBeDefined();
    }
  });

  it("is deterministic: same config + profile → same planId", () => {
    expect(buildPlan(CFG, "balanced").planId).toBe(buildPlan(CFG, "balanced").planId);
  });

  it("round-trips through save/load", () => {
    const plan = buildPlan(CFG, "balanced");
    savePlan(plan, PLANS);
    const loaded = loadPlan(plan.planId, PLANS);
    expect(loaded).toEqual(plan);
  });

  it("loadPlan returns null for unknown ids and rejects path traversal", () => {
    expect(loadPlan("nope", PLANS)).toBeNull();
    expect(loadPlan("../../etc/passwd", PLANS)).toBeNull();
  });
});
