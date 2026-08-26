import type { AuditResult } from "../../types.js";
import { section, type HermesConfig } from "./types.js";

export function auditHermesMemory(config: HermesConfig): AuditResult[] {
  const results: AuditResult[] = [];

  const memory = section(config, "memory");
  if (!memory) return results; // no memory section — nothing to audit

  const enabled = memory["memory_enabled"];
  results.push({
    category: "Hermes Memory",
    check: "Memory enabled",
    status: "info",
    message:
      enabled === undefined || enabled === null
        ? "memory.memory_enabled not set — Hermes default applies"
        : `memory_enabled: ${String(enabled)}`,
  });

  if (memory["write_approval"] === false) {
    results.push({
      category: "Hermes Memory",
      check: "Memory write approval",
      status: "warn",
      message: "memory.write_approval is false — the agent can edit its own memory unsupervised",
      fix: "Set memory.write_approval: true in ~/.hermes/config.yaml",
    });
  }

  return results;
}
