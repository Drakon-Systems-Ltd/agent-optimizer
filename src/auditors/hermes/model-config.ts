import type { AuditResult } from "../../types.js";
import { section, type HermesConfig } from "./types.js";

export function auditHermesModelConfig(config: HermesConfig): AuditResult[] {
  const results: AuditResult[] = [];

  const model = section(config, "model");
  const def = model?.["default"];
  if (typeof def === "string" && def.trim() !== "") {
    const provider = model?.["provider"];
    results.push({
      category: "Hermes Model Config",
      check: "Default model set",
      status: "pass",
      message: `Default model: ${def}${typeof provider === "string" && provider ? ` (provider: ${provider})` : ""}`,
    });
  } else {
    results.push({
      category: "Hermes Model Config",
      check: "Default model set",
      status: "fail",
      message: "No default model configured (model.default)",
      fix: "Set model.default in ~/.hermes/config.yaml (`hermes config edit`)",
    });
  }

  const fallbacks = config?.["fallback_providers"];
  if (Array.isArray(fallbacks) && fallbacks.length > 0) {
    results.push({
      category: "Hermes Model Config",
      check: "Fallback providers",
      status: "pass",
      message: `${fallbacks.length} fallback provider(s) configured`,
    });
  } else if (typeof fallbacks === "string") {
    // Stored-as-string defect — config-shape.ts emits the FAIL; don't double-report.
  } else {
    results.push({
      category: "Hermes Model Config",
      check: "Fallback providers",
      status: "warn",
      message: "No fallback providers configured — if the primary provider fails, the agent stops",
      fix: "Add entries under fallback_providers in ~/.hermes/config.yaml",
    });
  }

  return results;
}
