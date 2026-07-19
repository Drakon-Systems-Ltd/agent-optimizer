import type { AuditResult, OpenClawConfig } from "../types.js";
import { loadConfig, getConfigLoadIssues } from "./config.js";
import { PURE_CONFIG_AUDITORS } from "../auditors/openclaw/pure-auditors.js";

export interface VerifyResult {
  ok: boolean;
  // Fail-equivalent count for the post-apply config. NOTE: Infinity when the
  // config is unusable (parse error, missing, non-object, or an auditor crashed).
  // Infinity serializes to JSON `null` (JSON.stringify(Infinity) === "null"), so
  // any consumer emitting this over `--json` must normalize it (e.g. to null with
  // an explicit "unverifiable" flag, or a sentinel) before serialization.
  fails: number;
  reasons: string[];
}

const MAX_REASONS = 10;

// A result counts as a "fail-equivalent" if it is an outright fail, OR it is the
// "Unknown config keys" warn. OpenClaw's Zod schema is strict and rejects any
// config with unrecognized keys, so that warn is a hard load-blocking signal —
// exactly the class of breakage this post-apply verifier exists to catch.
function isFailEquivalent(r: AuditResult): boolean {
  return (
    r.status === "fail" ||
    (r.status === "warn" && r.check === "Unknown config keys")
  );
}

// Run the shared pure-auditor list (PURE_CONFIG_AUDITORS — one canonical source,
// so verify can't silently under-check when a new pure auditor is added) with
// PER-AUDITOR isolation. "Pure" (no fs/network) does NOT mean "cannot throw": a
// parseable-but-structurally-malformed post-apply config (e.g. `model.fallbacks`
// as an object, not an array) makes an auditor throw a TypeError. In
// verification, a crash on the post-apply config is itself a hard failure — but
// isolate each auditor so one crasher can't hide another's crash. Mirrors the
// isolation in runOpenClawAuditors (index.ts), with verify-specific semantics:
// any crash => the whole verify fails.
function runPureAuditors(config: OpenClawConfig): { results: AuditResult[]; crashes: string[] } {
  const results: AuditResult[] = [];
  const crashes: string[] = [];
  for (const auditor of PURE_CONFIG_AUDITORS) {
    try {
      results.push(...auditor(config));
    } catch (err) {
      crashes.push(
        `auditor crashed on config: ${auditor.name || "unknown"}: ${(err as Error).message}`
      );
    }
  }
  return { results, crashes };
}

type Loaded =
  | { ok: false; reasons: string[] }
  | { ok: true; failResults: AuditResult[]; failEquiv: number; issues: string[] };

// Single source of truth for the fail-equivalent count. countFails and
// verifyConfigFile both go through here so their counts can never diverge.
function loadAndAudit(path: string): Loaded {
  let config: OpenClawConfig | null;
  try {
    // loadConfig THROWS on JSON5 syntax errors (it does not return null for bad
    // syntax); a missing file or non-object resolves to null. Both mean the
    // post-apply config is unusable — never let the throw escape.
    config = loadConfig(path);
  } catch (err) {
    return { ok: false, reasons: [`config failed to parse after apply: ${(err as Error).message}`] };
  }
  if (!config) {
    return {
      ok: false,
      reasons: ["config failed to parse after apply: config missing or not a JSON object"],
    };
  }
  // getConfigLoadIssues() reflects the loadConfig call above (last one wins);
  // read it before the auditors run — they never call loadConfig, so it stays put.
  const issues = getConfigLoadIssues();
  const { results, crashes } = runPureAuditors(config);
  if (crashes.length > 0) {
    // An auditor crashing on the post-apply config is a hard verification
    // failure — treat it exactly like an unparseable config (fails: Infinity).
    return { ok: false, reasons: crashes };
  }
  const failResults = results.filter(isFailEquivalent);
  return { ok: true, failResults, failEquiv: failResults.length, issues };
}

/**
 * Baseline fail-equivalent count for a config, captured BEFORE a mutation.
 *
 * Returns Infinity when the pre-state cannot be parsed (syntax error, missing
 * file, non-object, or an auditor crashed on it). Why Infinity rather than 0: a
 * baseline you cannot compute must never make post-apply verification *easier*.
 * If an unreadable pre-state scored 0, any post-state with a single fail would
 * exceed it and get wrongly rolled back; if it scored some huge finite number,
 * nothing would ever roll back. Infinity encodes "unknown baseline ⇒ the
 * pre-state was already unusable, so don't trust a numeric comparison" — and
 * verifyConfigFile enforces that contract (a non-finite baseline collapses to a
 * strict zero-fail bar), so threading countFails straight in is safe.
 */
export function countFails(path: string): number {
  const loaded = loadAndAudit(path);
  if (!loaded.ok) return Infinity;
  return loaded.failEquiv;
}

/**
 * Verify a config file AFTER a mutation, relative to a pre-apply baseline count.
 *
 * ok is true only when: the config parsed, no auditor crashed on it, its
 * $include resolution is clean, and the fail-equivalent count did not rise above
 * the (trustworthy) baseline.
 */
export function verifyConfigFile(
  path: string,
  opts: { baselineFails: number }
): VerifyResult {
  const loaded = loadAndAudit(path);
  if (!loaded.ok) {
    return { ok: false, fails: Infinity, reasons: truncateReasons(loaded.reasons) };
  }

  // A non-finite baseline means the pre-apply state was itself unusable
  // (countFails returns Infinity for an unparseable/missing/crashing pre-state).
  // We cannot trust "failEquiv > baselineFails": failEquiv > Infinity is ALWAYS
  // false, which would silently green-light any regression. Collapse an
  // untrustworthy baseline to a strict zero-fail bar — any fail-equivalent in the
  // post-state then fails verification.
  const baseline = Number.isFinite(opts.baselineFails) ? opts.baselineFails : 0;

  const reasons: string[] = [];

  // Broken $include resolution (missing/cyclic/too-deep fragment) means OpenClaw
  // itself would fail to load this config — a hard fail regardless of audit count.
  if (loaded.issues.length > 0) reasons.push(...loaded.issues);

  const auditRegressed = loaded.failEquiv > baseline;
  if (auditRegressed) {
    // Shape "<category> / <check>: <message>" is load-bearing for Task 6 surfacing.
    reasons.push(
      ...loaded.failResults.map((r) => `${r.category} / ${r.check}: ${r.message}`)
    );
  }

  const ok = loaded.issues.length === 0 && !auditRegressed;
  return { ok, fails: loaded.failEquiv, reasons: truncateReasons(reasons) };
}

// Cap the TOTAL reason list (include issues + audit fails), not just one slice,
// so a config with many of both can't blow past the bound.
function truncateReasons(reasons: string[]): string[] {
  if (reasons.length <= MAX_REASONS) return reasons;
  return [...reasons.slice(0, MAX_REASONS), `…and ${reasons.length - MAX_REASONS} more`];
}
