import type { AuditResult, OpenClawConfig } from "../../types.js";
import { auditModelConfig } from "./model-config.js";
import { auditLegacyConfigKeys } from "./legacy-config-keys.js";
import { auditToolsByProvider } from "./tools-by-provider.js";
import { auditChannelSecurity } from "./channel-security.js";

/**
 * Pure, config-only auditors: each takes ONLY the parsed config (no agentDir,
 * openclawVersion, filesystem, or network) and returns AuditResult[]. This is
 * the exact subset that is safe to run against a freshly-mutated, not-yet-trusted
 * config during post-apply verification (src/utils/apply-verify.ts).
 *
 * This is a LEAF module on purpose: it imports only the 4 pure auditor functions
 * (+ types), never ora/chalk or the fs/sqlite-touching auditors that index.ts
 * pulls in. apply-verify imports from HERE so the verifier's module graph stays
 * free of the CLI presentation layer (safe for isolated/worker contexts).
 *
 * Inclusion criterion: signature is `(config: OpenClawConfig) => AuditResult[]`
 * with no side effects. ADD NEW PURE CONFIG-KEY AUDITORS HERE — apply-verify
 * imports this one list so verification can never silently under-check a new
 * hard-fail class (the dangerous, too-lenient direction).
 *
 * TODO(future): tag purity on the full runOpenClawAuditors registry (index.ts)
 * and derive both this list and that one from a single source. A shared constant
 * is the right scope for now.
 */
export const PURE_CONFIG_AUDITORS: ReadonlyArray<(config: OpenClawConfig) => AuditResult[]> = [
  auditModelConfig,
  auditLegacyConfigKeys,
  auditToolsByProvider,
  auditChannelSecurity,
];
