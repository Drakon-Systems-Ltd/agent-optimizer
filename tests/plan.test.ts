import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync } from "fs";
import { spawnSync } from "child_process";
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

  it("hash and planId change when the top-level config changes by one byte", () => {
    const before = buildPlan(CFG, "balanced");
    appendFileSync(CFG, " "); // trailing whitespace — still valid JSON
    const after = buildPlan(CFG, "balanced");
    expect(after.configHash).not.toBe(before.configHash);
    expect(after.planId).not.toBe(before.planId);
  });

  it("hash covers $include'd fragments, not just the top-level file", () => {
    const FRAG = join(DIR, "agents.json");
    writeFileSync(
      FRAG,
      JSON.stringify({ defaults: { contextTokens: 1000000, heartbeat: { every: "30m" } } })
    );
    writeFileSync(CFG, JSON.stringify({ agents: { $include: "agents.json" } }));
    const before = configHashOf(CFG);
    // standalone discovery must agree with buildPlan's hash
    expect(buildPlan(CFG, "balanced").configHash).toBe(before);
    // edit ONLY the fragment — top-level bytes are unchanged
    writeFileSync(
      FRAG,
      JSON.stringify({ defaults: { contextTokens: 900000, heartbeat: { every: "30m" } } })
    );
    expect(configHashOf(CFG)).not.toBe(before);
  });

  it("loadPlan throws with the file path on a corrupt plan file", () => {
    mkdirSync(PLANS, { recursive: true });
    writeFileSync(join(PLANS, "aaaaaaaaaaaa.json"), "{not json");
    expect(() => loadPlan("aaaaaaaaaaaa", PLANS)).toThrow(/aaaaaaaaaaaa\.json/);
  });

  it("loadPlan returns null for an unsupported schemaVersion", () => {
    mkdirSync(PLANS, { recursive: true });
    writeFileSync(join(PLANS, "bbbbbbbbbbbb.json"), JSON.stringify({ schemaVersion: 2 }));
    expect(loadPlan("bbbbbbbbbbbb", PLANS)).toBeNull();
  });

  it("buildPlan throws on an unknown profile", () => {
    expect(() => buildPlan(CFG, "turbo")).toThrow(/profile/i);
  });
});

describe("cli optimize --plan", () => {
  const CLI = join(process.cwd(), "src", "cli.ts");

  // HOME → test dir so defaultPlansDir() (and any license lookup) stays hermetic.
  function runPlan(...args: string[]) {
    return spawnSync(
      process.execPath,
      ["--import", "tsx", CLI, "optimize", "--plan", ...args],
      { encoding: "utf-8", cwd: process.cwd(), env: { ...process.env, HOME: DIR } }
    );
  }

  it("prints the persisted plan as pure JSON on stdout, banner on stderr", () => {
    const r = runPlan("-c", CFG);
    expect(r.status).toBe(0);
    const plan = JSON.parse(r.stdout);
    expect(plan.schemaVersion).toBe(1);
    expect(plan.profile).toBe("balanced");
    // stdout is exactly the persisted plan bytes (+ trailing newline)
    const file = join(DIR, ".agent-optimizer", "plans", `${plan.planId}.json`);
    expect(readFileSync(file, "utf-8")).toBe(JSON.stringify(plan, null, 2));
    expect(r.stdout).toBe(JSON.stringify(plan, null, 2) + "\n");
    expect(r.stderr).toContain("AGENT OPTIMIZER");
  }, 30_000);

  it("emits a structured JSON error for an unknown profile", () => {
    const r = runPlan("-c", CFG, "--profile", "turbo");
    expect(r.status).toBe(1);
    const err = JSON.parse(r.stdout);
    expect(err.error).toBe("plan-failed");
    expect(err.message).toMatch(/profile/i);
    expect(err.configPath).toBe(CFG);
  }, 30_000);

  it("emits a structured JSON error for a missing config", () => {
    const missing = join(DIR, "no-such-config.json");
    const r = runPlan("-c", missing);
    expect(r.status).toBe(1);
    const err = JSON.parse(r.stdout);
    expect(err.error).toBe("plan-failed");
    expect(err.message).toContain("Config not found");
    expect(err.configPath).toBe(missing);
  }, 30_000);

  it("emits a structured JSON error for a syntactically invalid config", () => {
    const broken = join(DIR, "broken.json");
    writeFileSync(broken, "{ this is not json5 ][");
    const r = runPlan("-c", broken);
    expect(r.status).toBe(1);
    const err = JSON.parse(r.stdout);
    expect(err.error).toBe("plan-failed");
    expect(err.configPath).toBe(broken);
  }, 30_000);
});
