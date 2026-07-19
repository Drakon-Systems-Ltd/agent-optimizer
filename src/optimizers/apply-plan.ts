import { readFileSync, writeFileSync, renameSync } from "fs";
import { loadConfig, expandPath } from "../utils/config.js";
import {
  transactionalApply,
  ApplyLockedError,
  ApplyPreconditionError,
  ApplyRolledBackError,
  RollbackFailedError,
} from "../utils/transactional.js";
import { planErrorEnvelope } from "../utils/cli-json.js";
import {
  loadPlan,
  configHashOf,
  defaultPlansDir,
  type OptimizePlan,
  type PlanProposal,
} from "./plan.js";
import { applyProposals } from "./openclaw/index.js";

/** The buy page, mirrored from cli.ts's other license prompts (kept as a literal
 *  there too — no shared constant exists yet). Injectable for tests. */
const DEFAULT_BUY_URL = "https://drakonsystems.com/products/agent-optimizer/buy";

export interface ApplyPlanOptions {
  /** -c path — the config to apply the plan against (may contain ~ / be relative). */
  config: string;
  /** The plan id to apply (12-hex; loadPlan regex-guards it). */
  applyPlan: string;
  /** Raw --only value: a comma-separated list of PROPOSAL IDS (not tags). When
   *  omitted, ALL non-info proposals in the plan are selected. When PROVIDED but
   *  naming no valid ids (empty/whitespace), it is a bad-selection — never a no-op. */
  only?: string;
  /** Whether a valid license is present — apply-plan mutates, so it is gated.
   *  Injected by the caller (the CLI checks hasValidLicense()); tests pass it. */
  licensed: boolean;
  /** Test-only injection; defaults to defaultPlansDir(). */
  plansDir?: string;
  /** Test-only injection; defaults to the real backup store via transactionalApply. */
  backupsDir?: string;
  /** Override the buy URL in the license-required error (defaults to the canonical one). */
  buyUrl?: string;
}

export interface ApplyPlanResult {
  /** The JSON object to print on stdout (success shape or error envelope). */
  json: unknown;
  /** The process exit code the caller must adopt. */
  exitCode: number;
}

/** Exit-code taxonomy. Codes 5–8 are one-per-class so the (benign) apply-rolled-
 *  back case can never be confused with the (critical) rollback-failed one. The
 *  lookup-failure codes intentionally share a family:
 *    0 success · 1 license-required/usage · 2 plan-not-found / plan-corrupt
 *    3 plan-stale · 4 bad-selection · 5 apply-rolled-back · 6 apply-locked
 *    7 apply-precondition · 8 rollback-failed
 */
function fail(
  slug: string,
  message: string,
  extra: Record<string, unknown>,
  exitCode: number
): ApplyPlanResult {
  return { json: planErrorEnvelope(slug, message, extra), exitCode };
}

/**
 * Map a transactionalApply failure to its distinct slug + exit code. Exported so
 * the full mapping (including the exit-8 double-failure path, which is impractical
 * to trigger through the single-file apply) can be unit-tested with constructed
 * errors.
 *
 * The `message` is the typed error's RAW `.message` — every transactional error
 * carries a clean, single-line message. We deliberately do NOT route through the
 * human formatter (apply-errors.ts) here: that emits terminal art (ANSI colour,
 * a leading newline, `•` bullets) and duplicates the structured `backupId` /
 * `reasons` siblings — noise on a pure-JSON machine path.
 */
export function mapApplyError(e: unknown, planId: string): ApplyPlanResult {
  if (e instanceof ApplyRolledBackError) {
    // Config untouched (auto-rolled back) — safe.
    return fail("apply-rolled-back", e.message, { planId, backupId: e.backupId, reasons: e.reasons }, 5);
  }
  if (e instanceof ApplyLockedError) {
    return fail("apply-locked", e.message, { planId }, 6);
  }
  if (e instanceof ApplyPreconditionError) {
    return fail("apply-precondition", e.message, { planId }, 7);
  }
  if (e instanceof RollbackFailedError) {
    // CRITICAL double-failure. `inconsistent` (some files reverted, at least one
    // not) is the loud flag; exit 8 is never shared with any other class.
    return fail(
      "rollback-failed",
      e.message,
      {
        planId,
        backupId: e.backupId,
        restored: e.restored,
        failed: e.failed,
        inconsistent: e.restored.length > 0,
      },
      8
    );
  }
  // Unexpected (a real bug, not a safety path). Use exit 1 rather than any of the
  // taxonomy codes so it can't be mistaken for a known class.
  return fail("apply-error", (e as Error)?.message ?? String(e), { planId }, 1);
}

/**
 * Apply exactly the human-approved subset of a persisted plan, transactionally,
 * behind a config-drift (staleness) guard. Pure logic — no printing, no
 * process.exit — so it can be unit-tested directly with injected plansDir /
 * backupsDir / licensed. The CLI action prints `json` and adopts `exitCode`.
 *
 * The invariants this enforces:
 *  - never apply against drifted state (the staleness guard fires before any write),
 *  - apply exactly the approved subset (info-only proposals are never applied),
 *  - a bad apply auto-rolls-back, and a failed rollback is unmistakable (exit 8),
 *  - every failure (and success) emits a pure-JSON envelope with a stable slug.
 */
export function runApplyPlan(opts: ApplyPlanOptions): ApplyPlanResult {
  const planId = opts.applyPlan;

  // Licensed gate — apply-plan MUTATES, so it requires a license (like optimize
  // apply). Checked first so an unlicensed caller never learns whether a plan
  // exists or whether the config has drifted.
  if (!opts.licensed) {
    return fail(
      "license-required",
      "Applying a plan requires a license",
      { buy: opts.buyUrl ?? DEFAULT_BUY_URL },
      1
    );
  }

  // 1. Load the plan. loadPlan returns null for an unknown id / bad format, but
  //    THROWS for a present-but-corrupt plan file (valid id, unparseable JSON) —
  //    guard it so that becomes a JSON slug, not a raw stack trace + empty stdout.
  let plan: OptimizePlan | null;
  try {
    plan = loadPlan(planId, opts.plansDir ?? defaultPlansDir());
  } catch (e) {
    return fail(
      "plan-corrupt",
      `Plan ${planId} exists but could not be read — re-plan (${(e as Error).message})`,
      { planId },
      2
    );
  }
  if (!plan) {
    return fail(
      "plan-not-found",
      `No plan with id ${planId} — run: agent-optimizer optimize --plan`,
      { planId },
      2
    );
  }

  // 2. Staleness guard (TOCTOU): recompute the config hash and refuse to apply
  //    against anything that has drifted since the plan was generated. A
  //    syntactically-broken / unreadable config throws — treat it as
  //    stale/unusable rather than applying against state we can't verify.
  let actual: string;
  try {
    actual = configHashOf(opts.config);
  } catch (e) {
    return fail(
      "plan-stale",
      `Config could not be read or parsed since the plan was generated — re-plan (${(e as Error).message})`,
      { planId, expected: plan.configHash, actual: "<unreadable>" },
      3
    );
  }
  if (actual !== plan.configHash) {
    return fail(
      "plan-stale",
      "Config changed since the plan was generated — re-plan",
      { planId, expected: plan.configHash, actual },
      3
    );
  }

  // 3. Selection. Info-only proposals are suggestions and are never applicable.
  const applicable = plan.proposals.filter((p) => !p.info);
  const validIds = applicable.map((p) => p.id);
  let selected: PlanProposal[];

  if (opts.only !== undefined) {
    // --only selects PROPOSAL IDS here (not tags, unlike the normal optimize path).
    const requested = opts.only
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    // PROVIDED but naming nothing (empty / all-whitespace) is a caller error, not
    // a silent no-op: an agent that built a bad selection string must hear about it.
    if (requested.length === 0) {
      return fail(
        "bad-selection",
        "--only was given but named no valid proposal ids",
        { planId, requested, invalid: [], infoOnly: [], validIds },
        4
      );
    }
    const byId = new Map(plan.proposals.map((p) => [p.id, p]));
    const invalid: string[] = []; // ids not present in the plan at all
    const infoOnly: string[] = []; // ids that resolve to info-only proposals
    const picked: PlanProposal[] = [];
    for (const id of requested) {
      const p = byId.get(id);
      if (!p) {
        invalid.push(id);
      } else if (p.info) {
        infoOnly.push(id);
      } else {
        picked.push(p);
      }
    }
    if (invalid.length > 0 || infoOnly.length > 0) {
      return fail(
        "bad-selection",
        "Requested proposal id(s) are unknown or info-only — info proposals are suggestions and cannot be applied",
        { planId, requested, invalid, infoOnly, validIds },
        4
      );
    }
    selected = picked;
  } else {
    // OMITTED --only = apply ALL non-info proposals.
    selected = applicable;
  }

  // --only omitted AND nothing applicable (e.g. a plan of only info-only
  // suggestions) — a success-shaped no-op, not an error.
  if (selected.length === 0) {
    return {
      json: {
        schemaVersion: 1,
        applied: [],
        note: "No applicable proposals to apply (info-only proposals are never applied).",
        planId,
      },
      exitCode: 0,
    };
  }

  // 4. Apply transactionally: snapshot → mutate → verify → auto-rollback on
  //    failure. The staleness guard above already parsed the config, so a null /
  //    throw here would be a genuine race — guard both as stale rather than crashing.
  let config;
  try {
    config = loadConfig(opts.config);
  } catch (e) {
    return fail(
      "plan-stale",
      `Config could not be loaded for apply — re-plan (${(e as Error).message})`,
      { planId, expected: plan.configHash, actual: "<unreadable>" },
      3
    );
  }
  if (!config) {
    return fail(
      "plan-stale",
      "Config could not be loaded for apply — re-plan",
      { planId, expected: plan.configHash, actual: "<unreadable>" },
      3
    );
  }
  const target = expandPath(opts.config);

  // Signal a JSON5 source rewrite: our mutate re-serializes the config as plain
  // JSON, stripping any comments / trailing commas. Detect it the way the optimizer
  // apply does — strict JSON.parse of the original throws for JSON5 — so the
  // approving agent sees `reformatted: true`. Safe (the backup preserves originals).
  let reformatted = false;
  try {
    JSON.parse(readFileSync(target, "utf-8"));
  } catch {
    reformatted = true;
  }

  try {
    const result = transactionalApply({
      files: [target],
      backupsDir: opts.backupsDir,
      mutate: () => {
        applyProposals(config, selected);
        // Atomic (temp + rename), matching optimize apply / savePlan / backups:
        // an interrupted direct write could truncate the live config a reading
        // gateway sees; rename swaps it in whole (the store backup wraps this
        // for verify/rollback).
        const tmp = `${target}.tmp-${process.pid}`;
        writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
        renameSync(tmp, target);
      },
    });
    return {
      json: {
        schemaVersion: 1,
        applied: selected.map((p) => p.id),
        planId,
        backupId: result.backupId,
        verified: true,
        requiresRestart: selected.some((p) => p.requiresRestart),
        reformatted,
        rollbackHint: `agent-optimizer rollback --to ${result.backupId}`,
      },
      exitCode: 0,
    };
  } catch (e) {
    return mapApplyError(e, planId);
  }
}
