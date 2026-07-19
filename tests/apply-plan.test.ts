import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
} from "fs";
import { spawnSync } from "child_process";
import { join } from "path";
import type { OpenClawConfig } from "../src/types.js";
import { applyProposals } from "../src/optimizers/openclaw/index.js";
import { runApplyPlan, mapApplyError } from "../src/optimizers/apply-plan.js";
import {
  ApplyLockedError,
  ApplyPreconditionError,
  ApplyRolledBackError,
  RollbackFailedError,
} from "../src/utils/transactional.js";
import {
  buildPlan,
  savePlan,
  configHashOf,
  type PlanProposal,
} from "../src/optimizers/plan.js";
import { listBackups } from "../src/utils/backups.js";

const DIR = join(process.cwd(), "__test_apply_plan__");
const CFG = join(DIR, "openclaw.json");
const PLANS = join(DIR, "plans");
const STORE = join(DIR, "store");

// A config that (a) parses cleanly with a valid model.primary so the pre-apply
// baseline is clean, and (b) triggers real applicable optimizations on aggressive
// (contextTokens 1M → 100k, heartbeat 1h → 12h, etc.).
const VALID = {
  agents: {
    defaults: {
      model: { primary: "anthropic/claude-opus-4-8", fallbacks: ["openai/gpt-5.6"] },
      contextTokens: 1000000,
    },
  },
};

function writeConfig(obj: unknown): void {
  writeFileSync(CFG, JSON.stringify(obj, null, 2));
}

/** Hand-write a plan file with a matching configHash (so the staleness guard
 *  passes) — lets us exercise proposals real optimizer output never produces
 *  (e.g. a verify-breaking recommended, or requiresRestart: true). */
function writeSyntheticPlan(planId: string, proposals: PlanProposal[]): void {
  mkdirSync(PLANS, { recursive: true });
  const plan = {
    schemaVersion: 1 as const,
    planId,
    createdAt: new Date().toISOString(),
    configPath: CFG,
    configHash: configHashOf(CFG),
    profile: "aggressive",
    proposals,
  };
  writeFileSync(join(PLANS, `${planId}.json`), JSON.stringify(plan, null, 2));
}

beforeEach(() => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeConfig(VALID);
});
afterEach(() => rmSync(DIR, { recursive: true, force: true }));

// A machine `message` must be free of terminal art: no ANSI escapes, no newlines,
// no `•` bullets — all things the human formatter (apply-errors.ts) injects.
function expectCleanMessage(msg: string): void {
  expect(msg).not.toMatch(/\[/); // ANSI CSI sequence
  expect(msg).not.toContain("\n");
  expect(msg).not.toContain("•");
}

// ── Part A: applyProposals (direct unit) ──────────────────────────────────
describe("applyProposals", () => {
  it("sets a scalar leaf at a dotted path", () => {
    const config: OpenClawConfig = { agents: { defaults: { contextTokens: 1000000 } } };
    applyProposals(config, [{ path: "agents.defaults.contextTokens", recommended: 100000 }]);
    expect(config.agents!.defaults!.contextTokens).toBe(100000);
  });

  it("sets a whole object value verbatim (e.g. contextPruning = {mode,ttl})", () => {
    const config: OpenClawConfig = { agents: { defaults: {} } };
    applyProposals(config, [
      { path: "agents.defaults.contextPruning", recommended: { mode: "cache-ttl", ttl: "2h" } },
    ]);
    expect(config.agents!.defaults!.contextPruning).toEqual({ mode: "cache-ttl", ttl: "2h" });
  });

  it("creates intermediate objects when the path does not yet exist", () => {
    const config: OpenClawConfig = {};
    applyProposals(config, [{ path: "channels.discord.historyLimit", recommended: 20 }]);
    expect((config as Record<string, any>).channels.discord.historyLimit).toBe(20);
  });

  it("applies every proposal given, in order (nothing is filtered out)", () => {
    const config: OpenClawConfig = { agents: { defaults: {} } };
    applyProposals(config, [
      { path: "agents.defaults.contextTokens", recommended: 100000 },
      { path: "agents.defaults.heartbeat.every", recommended: "12h" },
      { path: "tools.profile", recommended: "minimal" },
    ]);
    expect(config.agents!.defaults!.contextTokens).toBe(100000);
    expect(config.agents!.defaults!.heartbeat!.every).toBe("12h");
    expect(config.tools!.profile).toBe("minimal");
  });

  it("applies the STORED recommended verbatim (does not recompute from current)", () => {
    const config: OpenClawConfig = { agents: { defaults: { contextTokens: 42 } } };
    // A nonsensical stored value proves applyProposals never re-derives — it writes
    // exactly what the plan carried.
    applyProposals(config, [{ path: "agents.defaults.contextTokens", recommended: 777 }]);
    expect(config.agents!.defaults!.contextTokens).toBe(777);
  });
});

// ── Part C: runApplyPlan (direct, injected plansDir/backupsDir/licensed) ───
describe("runApplyPlan — license + lookup guards", () => {
  it("license-required (exit 1) when unlicensed — before any plan lookup", () => {
    const r = runApplyPlan({
      config: CFG,
      applyPlan: "ffffffffffff",
      licensed: false,
      plansDir: PLANS,
      backupsDir: STORE,
    });
    expect(r.exitCode).toBe(1);
    const j = r.json as Record<string, unknown>;
    expect(j.error).toBe("license-required");
    expect(j.buy).toBeTruthy();
    // No plan was ever created, and nothing was applied.
    expect(listBackups(STORE)).toHaveLength(0);
  });

  it("plan-not-found (exit 2) for an unknown but well-formed id", () => {
    const r = runApplyPlan({
      config: CFG,
      applyPlan: "ffffffffffff",
      licensed: true,
      plansDir: PLANS,
      backupsDir: STORE,
    });
    expect(r.exitCode).toBe(2);
    const j = r.json as Record<string, unknown>;
    expect(j.schemaVersion).toBe(1); // error envelope carries the machine version too
    expect(j.error).toBe("plan-not-found");
    expect(j.planId).toBe("ffffffffffff");
  });

  it("plan-corrupt (exit 2 + slug) for a valid-format id whose file is unparseable", () => {
    // loadPlan THROWS (not returns null) for a present-but-corrupt plan file — the
    // guard must turn that into a JSON slug, never a raw stack trace + empty stdout.
    mkdirSync(PLANS, { recursive: true });
    writeFileSync(join(PLANS, "abcdefabcdef.json"), "{ not json"); // valid id, corrupt body
    const r = runApplyPlan({
      config: CFG,
      applyPlan: "abcdefabcdef",
      licensed: true,
      plansDir: PLANS,
      backupsDir: STORE,
    });
    expect(r.exitCode).toBe(2);
    const j = r.json as Record<string, unknown>;
    expect(j.error).toBe("plan-corrupt");
    expect(j.planId).toBe("abcdefabcdef");
    // The envelope is well-formed JSON (round-trips) — the agent contract holds.
    expect(() => JSON.parse(JSON.stringify(j))).not.toThrow();
    expect(listBackups(STORE)).toHaveLength(0);
  });
});

describe("runApplyPlan — staleness guard", () => {
  it("plan-stale (exit 3) when the config drifts after planning", () => {
    const plan = buildPlan(CFG, "aggressive");
    savePlan(plan, PLANS);
    appendFileSync(CFG, " "); // still valid JSON, different bytes → different hash
    const r = runApplyPlan({
      config: CFG,
      applyPlan: plan.planId,
      licensed: true,
      plansDir: PLANS,
      backupsDir: STORE,
    });
    expect(r.exitCode).toBe(3);
    const j = r.json as Record<string, unknown>;
    expect(j.error).toBe("plan-stale");
    expect(j.expected).toBe(plan.configHash);
    expect(j.actual).not.toBe(plan.configHash);
    expect(typeof j.actual).toBe("string");
    // The guard fired BEFORE any write — no backup taken.
    expect(listBackups(STORE)).toHaveLength(0);
  });

  it("plan-stale (exit 3) when the config becomes syntactically broken", () => {
    const plan = buildPlan(CFG, "aggressive");
    savePlan(plan, PLANS);
    writeFileSync(CFG, "{ not json ]["); // unparseable → configHashOf throws
    const r = runApplyPlan({
      config: CFG,
      applyPlan: plan.planId,
      licensed: true,
      plansDir: PLANS,
      backupsDir: STORE,
    });
    expect(r.exitCode).toBe(3);
    const j = r.json as Record<string, unknown>;
    expect(j.error).toBe("plan-stale");
    expect(j.actual).toBe("<unreadable>");
    expect(listBackups(STORE)).toHaveLength(0);
  });
});

describe("runApplyPlan — selection", () => {
  it("bad-selection (exit 4) for an unknown id and an info-only id", () => {
    const plan = buildPlan(CFG, "aggressive");
    savePlan(plan, PLANS);
    const info = plan.proposals.find((p) => p.info)!;
    const applicableIds = plan.proposals.filter((p) => !p.info).map((p) => p.id);
    expect(info).toBeDefined();

    const before = readFileSync(CFG, "utf-8");
    const r = runApplyPlan({
      config: CFG,
      applyPlan: plan.planId,
      only: `p99-nope,${info.id}`,
      licensed: true,
      plansDir: PLANS,
      backupsDir: STORE,
    });
    expect(r.exitCode).toBe(4);
    const j = r.json as Record<string, unknown>;
    expect(j.error).toBe("bad-selection");
    expect(j.invalid).toEqual(["p99-nope"]);
    expect(j.infoOnly).toEqual([info.id]);
    expect(j.validIds).toEqual(applicableIds);
    // Nothing applied — config untouched, no backup.
    expect(readFileSync(CFG, "utf-8")).toBe(before);
    expect(listBackups(STORE)).toHaveLength(0);
  });

  it("bad-selection (exit 4) when --only is PROVIDED but names no valid ids (empty/whitespace)", () => {
    // OMITTED --only = all non-info (a no-op is fine). PROVIDED-but-empty is a
    // caller error — an agent that built a bad selection string must NOT get a
    // silent success no-op.
    const plan = buildPlan(CFG, "aggressive");
    savePlan(plan, PLANS);
    const before = readFileSync(CFG, "utf-8");
    for (const empty of ["", "   ", " , , "]) {
      const r = runApplyPlan({
        config: CFG,
        applyPlan: plan.planId,
        only: empty,
        licensed: true,
        plansDir: PLANS,
        backupsDir: STORE,
      });
      expect(r.exitCode).toBe(4);
      const j = r.json as Record<string, unknown>;
      expect(j.error).toBe("bad-selection");
      expect(j.message).toMatch(/named no valid proposal ids/i);
    }
    expect(readFileSync(CFG, "utf-8")).toBe(before);
    expect(listBackups(STORE)).toHaveLength(0);
  });

  it("info-only-omitted → applied: [] (exit 0) and no write when the plan is all info", () => {
    const ONLY_INFO = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-opus-4-8", fallbacks: ["openai/gpt-5.6"] },
          contextTokens: 100000,
          heartbeat: { every: "12h", isolatedSession: true },
          subagents: { maxConcurrent: 2 },
          compaction: { mode: "safeguard" },
          contextPruning: { mode: "cache-ttl" },
          imageMaxDimensionPx: 800,
          bootstrapMaxChars: 10000,
          bootstrapTotalMaxChars: 100000,
        },
      },
      tools: { profile: "minimal" },
    };
    writeConfig(ONLY_INFO);
    const plan = buildPlan(CFG, "aggressive");
    // Sanity: this fixture yields ONLY info-only proposals.
    expect(plan.proposals.length).toBeGreaterThan(0);
    expect(plan.proposals.every((p) => p.info)).toBe(true);
    savePlan(plan, PLANS);
    const before = readFileSync(CFG, "utf-8");

    const r = runApplyPlan({
      config: CFG,
      applyPlan: plan.planId,
      licensed: true,
      plansDir: PLANS,
      backupsDir: STORE,
    });
    expect(r.exitCode).toBe(0);
    const j = r.json as Record<string, unknown>;
    expect(j.schemaVersion).toBe(1); // the info-only no-op success is versioned too
    expect(j.applied).toEqual([]);
    expect(j.note).toMatch(/info-only/i);
    // No mutation and no backup — apply never ran.
    expect(readFileSync(CFG, "utf-8")).toBe(before);
    expect(listBackups(STORE)).toHaveLength(0);
  });
});

describe("runApplyPlan — transactional apply", () => {
  it("happy path: --only applies exactly the selected proposal, writes a store backup", () => {
    const plan = buildPlan(CFG, "aggressive");
    savePlan(plan, PLANS);
    const ctx = plan.proposals.find((p) => p.tag === "context")!;
    expect(ctx).toBeDefined();

    const r = runApplyPlan({
      config: CFG,
      applyPlan: plan.planId,
      only: ctx.id,
      licensed: true,
      plansDir: PLANS,
      backupsDir: STORE,
    });
    expect(r.exitCode).toBe(0);
    const j = r.json as Record<string, unknown>;
    expect(j.schemaVersion).toBe(1); // success payload carries the machine version
    expect(j.applied).toEqual([ctx.id]);
    expect(j.planId).toBe(plan.planId); // the happy-path response is correlatable
    expect(j.backupId).toBeTruthy();
    expect(j.verified).toBe(true);
    expect(typeof j.requiresRestart).toBe("boolean");
    expect(j.reformatted).toBe(false); // source config was plain JSON
    expect(j.rollbackHint).toBe(`agent-optimizer rollback --to ${j.backupId}`);

    // The change landed on disk...
    expect(JSON.parse(readFileSync(CFG, "utf-8")).agents.defaults.contextTokens).toBe(100000);
    // ...and a single store generation snapshots the config.
    const gens = listBackups(STORE);
    expect(gens).toHaveLength(1);
    expect(gens[0].id).toBe(j.backupId);
  });

  it("happy path: --only omitted applies ALL non-info proposals", () => {
    const plan = buildPlan(CFG, "aggressive");
    savePlan(plan, PLANS);
    const applicableIds = plan.proposals.filter((p) => !p.info).map((p) => p.id);

    const r = runApplyPlan({
      config: CFG,
      applyPlan: plan.planId,
      licensed: true,
      plansDir: PLANS,
      backupsDir: STORE,
    });
    expect(r.exitCode).toBe(0);
    const j = r.json as Record<string, unknown>;
    expect(j.applied).toEqual(applicableIds);
    expect(j.planId).toBe(plan.planId);
    // Applied verbatim recommendations — e.g. context 1M → 100k, tools → minimal.
    const written = JSON.parse(readFileSync(CFG, "utf-8"));
    expect(written.agents.defaults.contextTokens).toBe(100000);
    expect(written.tools.profile).toBe("minimal");
    expect(listBackups(STORE)).toHaveLength(1);
  });

  it("requiresRestart is the OR of selected proposals' requiresRestart", () => {
    // Synthetic plan: one restart-free proposal + one requiresRestart proposal,
    // both with schema-valid recommendations so verify passes.
    writeSyntheticPlan("aaaaaaaaaaaa", [
      {
        id: "p1-context",
        tag: "context",
        path: "agents.defaults.contextTokens",
        current: 1000000,
        recommended: 200000,
        reason: "x",
        risk: "low",
        requiresRestart: false,
      },
      {
        id: "p2-restart",
        tag: "heartbeat",
        path: "agents.defaults.heartbeat.every",
        current: "1h",
        recommended: "12h",
        reason: "x",
        risk: "medium",
        requiresRestart: true,
      },
    ]);
    const r = runApplyPlan({
      config: CFG,
      applyPlan: "aaaaaaaaaaaa",
      licensed: true,
      plansDir: PLANS,
      backupsDir: STORE,
    });
    expect(r.exitCode).toBe(0);
    const j = r.json as Record<string, unknown>;
    expect(j.applied).toEqual(["p1-context", "p2-restart"]);
    expect(j.requiresRestart).toBe(true);
  });

  it("requiresRestart narrows with the subset: --only the restart-free id → false", () => {
    // Same two-proposal synthetic plan, but select ONLY the restart-free one — the
    // OR must reflect the actual subset applied, not the whole plan.
    writeSyntheticPlan("cccccccccccc", [
      {
        id: "p1-context",
        tag: "context",
        path: "agents.defaults.contextTokens",
        current: 1000000,
        recommended: 200000,
        reason: "x",
        risk: "low",
        requiresRestart: false,
      },
      {
        id: "p2-restart",
        tag: "heartbeat",
        path: "agents.defaults.heartbeat.every",
        current: "1h",
        recommended: "12h",
        reason: "x",
        risk: "medium",
        requiresRestart: true,
      },
    ]);
    const r = runApplyPlan({
      config: CFG,
      applyPlan: "cccccccccccc",
      only: "p1-context",
      licensed: true,
      plansDir: PLANS,
      backupsDir: STORE,
    });
    expect(r.exitCode).toBe(0);
    const j = r.json as Record<string, unknown>;
    expect(j.applied).toEqual(["p1-context"]);
    expect(j.requiresRestart).toBe(false); // the restart proposal was NOT selected
  });

  it("reformatted: true when the source config is JSON5 (comments stripped on apply)", () => {
    // Valid JSON5 (a comment) — parses via the JSON5 path, throws under strict JSON.
    const json5 =
      `{\n  // heavy context\n  "agents": { "defaults": { "model": { "primary": "anthropic/claude-opus-4-8", "fallbacks": ["openai/gpt-5.6"] }, "contextTokens": 1000000 } }\n}`;
    writeFileSync(CFG, json5);
    const plan = buildPlan(CFG, "aggressive");
    savePlan(plan, PLANS);
    const ctx = plan.proposals.find((p) => p.tag === "context")!;
    const r = runApplyPlan({
      config: CFG,
      applyPlan: plan.planId,
      only: ctx.id,
      licensed: true,
      plansDir: PLANS,
      backupsDir: STORE,
    });
    expect(r.exitCode).toBe(0);
    const j = r.json as Record<string, unknown>;
    expect(j.reformatted).toBe(true);
    // The file is now plain JSON (comment gone); the backup preserves the original.
    expect(readFileSync(CFG, "utf-8")).not.toContain("// heavy context");
  });

  it("apply-rolled-back (exit 5): a verify-breaking recommended auto-rolls back, config restored", () => {
    const before = readFileSync(CFG, "utf-8");
    // thinkingDefault: "nope" is a real (parseable) audit fail — verify rejects it.
    writeSyntheticPlan("deadbeefcafe", [
      {
        id: "p1-bad",
        tag: "context",
        path: "agents.defaults.thinkingDefault",
        current: "unset",
        recommended: "nope",
        reason: "inject a verify-breaking value",
        risk: "low",
        requiresRestart: false,
      },
    ]);
    const r = runApplyPlan({
      config: CFG,
      applyPlan: "deadbeefcafe",
      licensed: true,
      plansDir: PLANS,
      backupsDir: STORE,
    });
    expect(r.exitCode).toBe(5);
    const j = r.json as Record<string, unknown>;
    expect(j.error).toBe("apply-rolled-back");
    expect(j.backupId).toBeTruthy();
    expect(Array.isArray(j.reasons)).toBe(true);
    expect((j.reasons as unknown[]).length).toBeGreaterThan(0);
    // Auto-rolled back to the EXACT pre-apply bytes.
    expect(readFileSync(CFG, "utf-8")).toBe(before);
  });

  it("apply-locked (exit 6) when another apply holds a fresh lock", () => {
    // The lock dir derives to dirname(resolve(STORE))/apply.lock = DIR/apply.lock.
    const LOCK = join(DIR, "apply.lock");
    mkdirSync(LOCK, { recursive: true });
    writeFileSync(join(LOCK, "lock.json"), JSON.stringify({ pid: 999999, startedAt: Date.now() }));
    const plan = buildPlan(CFG, "aggressive");
    savePlan(plan, PLANS);
    const ctx = plan.proposals.find((p) => p.tag === "context")!;
    const r = runApplyPlan({
      config: CFG,
      applyPlan: plan.planId,
      only: ctx.id,
      licensed: true,
      plansDir: PLANS,
      backupsDir: STORE,
    });
    expect(r.exitCode).toBe(6);
    expect((r.json as Record<string, unknown>).error).toBe("apply-locked");
  });
});

// ── Transactional-failure → slug + exit-code mapping (constructed errors) ──
// The 4 typed errors are exercised via constructed instances (mirroring
// apply-errors.test.ts). This is the ONLY practical way to cover the exit-8
// double-failure: runApplyPlan snapshots a single file, so a partial (restored>0)
// rollback failure can't arise organically through it.
describe("mapApplyError — distinct slug + exit code per failure class", () => {
  it("ApplyRolledBackError → apply-rolled-back, exit 5 (config safe), RAW clean message", () => {
    const r = mapApplyError(
      new ApplyRolledBackError("rolled-back-raw-message", { reasons: ["r1"], backupId: "B" }),
      "pln"
    );
    expect(r.exitCode).toBe(5);
    const j = r.json as Record<string, unknown>;
    expect(j.error).toBe("apply-rolled-back");
    expect(j.backupId).toBe("B");
    expect(j.reasons).toEqual(["r1"]);
    expect(j.planId).toBe("pln");
    // The message is the error's RAW .message, NOT formatApplyError's terminal art
    // (which would inject \n + `•` bullets and duplicate backupId/reasons).
    expect(j.message).toBe("rolled-back-raw-message");
    expectCleanMessage(j.message as string);
  });

  it("ApplyLockedError → apply-locked, exit 6, RAW clean message", () => {
    const r = mapApplyError(new ApplyLockedError("locked-raw-message"), "pln");
    expect(r.exitCode).toBe(6);
    const j = r.json as Record<string, unknown>;
    expect(j.error).toBe("apply-locked");
    expect(j.message).toBe("locked-raw-message");
    expectCleanMessage(j.message as string);
  });

  it("ApplyPreconditionError → apply-precondition, exit 7, raw message", () => {
    const r = mapApplyError(new ApplyPreconditionError("baseline unusable"), "pln");
    expect(r.exitCode).toBe(7);
    const j = r.json as Record<string, unknown>;
    expect(j.error).toBe("apply-precondition");
    expect(j.message).toBe("baseline unusable");
  });

  it("RollbackFailedError (partial) → rollback-failed, exit 8, inconsistent: true, RAW clean message", () => {
    const r = mapApplyError(
      new RollbackFailedError("rollback-failed-raw-message", {
        reasons: ["boom"],
        backupId: "B",
        restored: ["/a"],
        failed: "/b",
      }),
      "pln"
    );
    // Exit 8 is the CRITICAL, unmistakable code — never shared with any other class.
    expect(r.exitCode).toBe(8);
    const j = r.json as Record<string, unknown>;
    expect(j.error).toBe("rollback-failed");
    expect(j.backupId).toBe("B");
    expect(j.restored).toEqual(["/a"]);
    expect(j.failed).toBe("/b");
    expect(j.inconsistent).toBe(true); // some reverted, at least one not → disk mixed
    expect(j.message).toBe("rollback-failed-raw-message");
    expectCleanMessage(j.message as string);
  });

  it("RollbackFailedError (nothing restored) → exit 8, inconsistent: false", () => {
    const r = mapApplyError(
      new RollbackFailedError("x", { reasons: ["boom"], backupId: "B", restored: [], failed: "" }),
      "pln"
    );
    expect(r.exitCode).toBe(8);
    expect((r.json as Record<string, unknown>).inconsistent).toBe(false);
  });

  it("all failure classes map to distinct exit codes", () => {
    const codes = [
      mapApplyError(new ApplyRolledBackError("x", { reasons: [], backupId: "B" }), "p").exitCode,
      mapApplyError(new ApplyLockedError("x"), "p").exitCode,
      mapApplyError(new ApplyPreconditionError("x"), "p").exitCode,
      mapApplyError(
        new RollbackFailedError("x", { reasons: [], backupId: "B", restored: [], failed: "" }),
        "p"
      ).exitCode,
    ];
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual([5, 6, 7, 8]);
  });
});

// ── Part C: CLI wiring (spawned, hermetic HOME, hard timeout) ──────────────
describe("cli optimize --apply-plan", () => {
  const CLI = join(process.cwd(), "src", "cli.ts");

  function runCli(...args: string[]) {
    return spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
      encoding: "utf-8",
      cwd: process.cwd(),
      env: { ...process.env, HOME: DIR },
      timeout: 20000,
      killSignal: "SIGKILL",
    });
  }

  // A license whose signature carries no "." skips JWT verification, and a null
  // expiry never expires — so validateLicense() accepts it offline. HOME→DIR
  // means the CLI reads it from DIR/.agent-optimizer/license.json.
  function installLicense() {
    const dir = join(DIR, ".agent-optimizer");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "license.json"),
      JSON.stringify({
        key: "AO-SOLO-DEADBEEF-CAFEBABE",
        data: {
          email: "t@example.com",
          tier: "solo",
          issuedAt: new Date().toISOString(),
          expiresAt: null,
          stripePaymentId: "x",
        },
        signature: "offline",
      })
    );
  }

  function plan(): any {
    const r = runCli("optimize", "--plan", "-c", CFG);
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  }

  it("happy path: applies exactly the selected proposal, pure JSON on stdout, backup exists", () => {
    const p = plan();
    const ctxId = p.proposals.find((x: any) => x.tag === "context").id;
    installLicense();
    const r = runCli("optimize", "--apply-plan", p.planId, "--only", ctxId, "-c", CFG);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout); // stdout is PURE JSON
    expect(out.schemaVersion).toBe(1); // end-to-end: the emitted stdout is versioned
    expect(out.applied).toEqual([ctxId]);
    expect(out.planId).toBe(p.planId);
    expect(out.backupId).toBeTruthy();
    expect(out.verified).toBe(true);
    expect(out.reformatted).toBe(false);
    expect(out.rollbackHint).toContain(out.backupId);
    // Banner + human text went to stderr, not stdout.
    expect(r.stderr).toContain("AGENT OPTIMIZER");
    // Change on disk reflects the plan's STORED recommended, applied verbatim.
    // --plan defaulted to the `balanced` profile, whose context target is 200k
    // (not aggressive's 100k) — proving apply-plan uses the plan, not a re-derive.
    expect(JSON.parse(readFileSync(CFG, "utf-8")).agents.defaults.contextTokens).toBe(200000);
    // A store backup exists under the hermetic HOME.
    expect(listBackups(join(DIR, ".agent-optimizer", "backups"))).toHaveLength(1);
  }, 30_000);

  it("accepts a redundant --json flag on the always-JSON verb (not 'unknown option')", () => {
    // Task 11/12 invoke `optimize --apply-plan <id> --json`. commander must ACCEPT
    // --json (absorb it) — rejecting it would be exit 1 + empty stdout, which an
    // agent can't tell apart from a real failure. Output is unchanged by --json.
    const p = plan();
    const ctxId = p.proposals.find((x: any) => x.tag === "context").id;
    installLicense();
    const r = runCli("optimize", "--apply-plan", p.planId, "--only", ctxId, "--json", "-c", CFG);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.applied).toEqual([ctxId]);
    expect(out.backupId).toBeTruthy();
  }, 30_000);

  it("license-required → exit 1 + slug when no license is installed", () => {
    const r = runCli("optimize", "--apply-plan", "ffffffffffff", "-c", CFG);
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.error).toBe("license-required");
    expect(out.buy).toBeTruthy();
  }, 30_000);

  it("plan-not-found → exit 2 + slug", () => {
    installLicense();
    const r = runCli("optimize", "--apply-plan", "ffffffffffff", "-c", CFG);
    expect(r.status).toBe(2);
    const out = JSON.parse(r.stdout);
    expect(out.schemaVersion).toBe(1); // end-to-end: the emitted error stdout is versioned
    expect(out.error).toBe("plan-not-found");
    expect(out.planId).toBe("ffffffffffff");
  }, 30_000);

  it("plan-stale → exit 3 + slug + expected/actual when the config drifts", () => {
    const p = plan();
    installLicense();
    appendFileSync(CFG, " "); // drift the config after planning
    const r = runCli("optimize", "--apply-plan", p.planId, "-c", CFG);
    expect(r.status).toBe(3);
    const out = JSON.parse(r.stdout);
    expect(out.error).toBe("plan-stale");
    expect(out.expected).toBe(p.configHash);
    expect(out.actual).not.toBe(p.configHash);
  }, 30_000);
});
