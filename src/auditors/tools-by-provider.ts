import type { AuditResult, OpenClawConfig } from "../types.js";

const KNOWN_PROFILES = new Set(["minimal", "coding", "default"]);

export function auditToolsByProvider(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];
  const byProvider = config.tools?.byProvider;
  if (!byProvider) return results;

  for (const [key, entry] of Object.entries(byProvider)) {
    if (key === "") {
      results.push({
        category: "Tools / byProvider",
        check: "Empty provider key",
        status: "warn",
        message: "tools.byProvider has an empty-string key — likely a config typo, this entry will never match a real provider",
        fix: 'Replace "" with a real provider key (e.g. "openai/gpt-5.2")',
      });
      continue;
    }

    if (entry?.profile && !KNOWN_PROFILES.has(entry.profile)) {
      results.push({
        category: "Tools / byProvider",
        check: `Unknown profile: ${key}`,
        status: "fail",
        message: `tools.byProvider["${key}"].profile = "${entry.profile}" is not a recognised profile`,
        fix: `Use one of: ${[...KNOWN_PROFILES].join(", ")}`,
      });
    }

    const allow = entry?.allow ?? [];
    const deny = entry?.deny ?? [];
    if (allow.length > 0 && deny.length > 0) {
      const conflicts = allow.filter(t => deny.includes(t));
      if (conflicts.length > 0) {
        results.push({
          category: "Tools / byProvider",
          check: `Allow/deny conflict: ${key}`,
          status: "fail",
          message: `tools.byProvider["${key}"] has tool(s) in both allow and deny: ${conflicts.join(", ")}`,
          fix: "Remove the duplicate(s) from either allow or deny",
        });
      }
    }
  }

  return results;
}
