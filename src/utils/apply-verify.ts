import type { AuditResult, OpenClawConfig } from "../types.js";
import { loadConfig, getConfigLoadIssues } from "./config.js";
import { auditModelConfig } from "../auditors/openclaw/model-config.js";
import { auditLegacyConfigKeys } from "../auditors/openclaw/legacy-config-keys.js";
import { auditToolsByProvider } from "../auditors/openclaw/tools-by-provider.js";
import { auditChannelSecurity } from "../auditors/openclaw/channel-security.js";

export interface VerifyResult {
  ok: boolean;
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

// The four PURE auditors used for post-apply verification. Each takes only the
// parsed config and returns AuditResult[] — none touches the filesystem or
// network, so running them off a freshly-mutated config is side-effect free.
function runPureAuditors(config: OpenClawConfig): AuditResult[] {
  return [
    ...auditModelConfig(config),
    ...auditLegacyConfigKeys(config),
    ...auditToolsByProvider(config),
    ...auditChannelSecurity(config),
  ];
}

type Loaded =
  | { ok: false; detail: string }
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
    return { ok: false, detail: (err as Error).message };
  }
  if (!config) {
    return { ok: false, detail: "config missing or not a JSON object" };
  }
  // getConfigLoadIssues() reflects the loadConfig call above (last one wins);
  // read it before the auditors run — they never call loadConfig, so it stays put.
  const issues = getConfigLoadIssues();
  const failResults = runPureAuditors(config).filter(isFailEquivalent);
  return { ok: true, failResults, failEquiv: failResults.length, issues };
}

/**
 * Baseline fail-equivalent count for a config, captured BEFORE a mutation.
 *
 * Returns Infinity when the pre-state cannot be parsed (syntax error, missing
 * file, or non-object). Why Infinity rather than 0: a baseline you cannot
 * compute must never make post-apply verification *easier*. If an unreadable
 * pre-state scored 0, any post-state with a single fail would exceed it and get
 * wrongly rolled back; if it scored some huge finite number, nothing would ever
 * roll back. Infinity encodes "unknown baseline ⇒ the pre-state was already
 * unusable, so don't trust a numeric comparison" — a non-finite baseline is its
 * own signal that callers / Task 6 handle specially instead of comparing.
 */
export function countFails(path: string): number {
  const loaded = loadAndAudit(path);
  if (!loaded.ok) return Infinity;
  return loaded.failEquiv;
}

/**
 * Verify a config file AFTER a mutation, relative to a pre-apply baseline count.
 *
 * ok is true only when: the config parsed, its $include resolution is clean, and
 * the fail-equivalent count did not rise above `baselineFails`.
 */
export function verifyConfigFile(
  path: string,
  opts: { baselineFails: number }
): VerifyResult {
  const loaded = loadAndAudit(path);
  if (!loaded.ok) {
    return {
      ok: false,
      fails: Infinity,
      reasons: [`config failed to parse after apply: ${loaded.detail}`],
    };
  }

  const reasons: string[] = [];

  // Broken $include resolution (missing/cyclic/too-deep fragment) means OpenClaw
  // itself would fail to load this config — a hard fail regardless of audit count.
  if (loaded.issues.length > 0) reasons.push(...loaded.issues);

  const auditRegressed = loaded.failEquiv > opts.baselineFails;
  if (auditRegressed) {
    const failing = loaded.failResults.map(
      (r) => `${r.category} / ${r.check}: ${r.message}`
    );
    const shown = failing.slice(0, MAX_REASONS);
    if (failing.length > MAX_REASONS) {
      shown.push(`…and ${failing.length - MAX_REASONS} more`);
    }
    reasons.push(...shown);
  }

  const ok = loaded.issues.length === 0 && !auditRegressed;
  return { ok, fails: loaded.failEquiv, reasons };
}
