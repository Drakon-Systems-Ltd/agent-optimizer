import type { AuditResult } from "../../types.js";
import { section, type HermesConfig } from "./types.js";

export function auditHermesPrivacy(config: HermesConfig): AuditResult[] {
  const results: AuditResult[] = [];

  const privacy = section(config, "privacy");
  if (privacy?.["redact_pii"] === true) {
    results.push({
      category: "Hermes Privacy",
      check: "PII redaction",
      status: "pass",
      message: "privacy.redact_pii is enabled",
    });
  } else {
    results.push({
      category: "Hermes Privacy",
      check: "PII redaction",
      status: "info",
      message: "privacy.redact_pii is not enabled — consider redacting PII from provider-bound context",
      fix: "Set privacy.redact_pii: true in ~/.hermes/config.yaml",
    });
  }

  return results;
}
