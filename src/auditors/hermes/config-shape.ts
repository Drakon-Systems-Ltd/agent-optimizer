import type { AuditResult } from "../../types.js";
import type { HermesConfig } from "./types.js";

// Known Hermes field defect: `hermes config set` on a list-valued key silently
// stores the whole value as ONE QUOTED STRING (e.g. fallback_providers:
// "[{'provider': 'openrouter'}]") and `hermes config check` still reports
// healthy. The agent then runs with no fallbacks / an inert allowlist. Detect
// the artefact by shape: a string where a list belongs, that looks like a
// serialized list (starts with "[" or contains ",").
const LIST_VALUED_KEYS = ["fallback_providers", "command_allowlist"];

export function auditHermesConfigShape(config: HermesConfig): AuditResult[] {
  const results: AuditResult[] = [];

  for (const key of LIST_VALUED_KEYS) {
    const value = config?.[key];
    if (value === undefined || value === null) continue; // absent — model-config/approvals cover it

    if (typeof value === "string") {
      const trimmed = value.trim();
      const looksSerialized = trimmed.startsWith("[") || trimmed.includes(",");
      if (looksSerialized) {
        results.push({
          category: "Hermes Config Shape",
          check: `${key} stored as list`,
          status: "fail",
          message: `${key} is stored as a quoted string, not a list — likely a \`hermes config set\` artefact (\`hermes config check\` still reports healthy on this defect, but the value is inert)`,
          fix: `Re-edit with \`hermes config edit\` and replace the quoted string with a real YAML list under ${key}`,
        });
      } else {
        // A bare scalar where a list belongs is still wrong, just not the known
        // one-quoted-string artefact signature.
        results.push({
          category: "Hermes Config Shape",
          check: `${key} stored as list`,
          status: "warn",
          message: `${key} is a string ("${trimmed.slice(0, 60)}") but Hermes expects a list here`,
          fix: `Make ${key} a YAML list (\`hermes config edit\`)`,
        });
      }
    } else if (Array.isArray(value)) {
      results.push({
        category: "Hermes Config Shape",
        check: `${key} stored as list`,
        status: "pass",
        message: `${key} is a proper list (${value.length} entr${value.length === 1 ? "y" : "ies"})`,
      });
    }
    // Any other type (mapping, number, bool): unknown schema drift — skip.
  }

  return results;
}
