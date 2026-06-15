import type { AuditResult, OpenClawConfig } from "../../types.js";

const LOSSLESS_CLAW = "lossless-claw";

const MIGRATION_FIX =
  'Move to plugins.slots.contextEngine: "lossless-claw" + ' +
  "plugins.entries.lossless-claw.config.summaryModel, then run: openclaw doctor --fix";

export function auditCompactionEngine(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];

  const defaultsProvider = config.agents?.defaults?.compaction?.provider;
  if (defaultsProvider === LOSSLESS_CLAW) {
    const contextEngine = config.plugins?.slots?.contextEngine;
    const conflicting =
      typeof contextEngine === "string" &&
      contextEngine !== "" &&
      contextEngine !== LOSSLESS_CLAW;

    if (conflicting) {
      results.push({
        category: "Compaction",
        check: "Legacy compaction provider",
        status: "warn",
        message:
          'agents.defaults.compaction.provider is set to "lossless-claw" (deprecated), but ' +
          `plugins.slots.contextEngine is already set to "${contextEngine}" — ` +
          '"openclaw doctor --fix" will REFUSE auto-migration. A manual move is required.',
        fix: MIGRATION_FIX,
      });
    } else {
      results.push({
        category: "Compaction",
        check: "Legacy compaction provider",
        status: "info",
        message:
          'agents.defaults.compaction.provider: "lossless-claw" is deprecated in favour of ' +
          "plugins.slots.contextEngine. It still parses, so this is non-fatal — but it is only " +
          "migrated for Codex-runtime agents.",
        fix: MIGRATION_FIX,
      });
    }
  }

  // Defensive: loadConfig() does a raw JSON.parse with no schema validation, so
  // a hand-edited config may have a non-array list or null/non-object elements.
  const list = Array.isArray(config.agents?.list) ? config.agents.list : [];
  for (const rawEntry of list) {
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const entry = rawEntry as Record<string, any>;
    const provider = entry.compaction?.provider;
    if (provider === LOSSLESS_CLAW) {
      const agentId = entry.id ?? entry.name ?? "unknown";
      results.push({
        category: "Compaction",
        check: `Legacy compaction provider (agent: ${agentId})`,
        status: "info",
        message:
          `Agent "${agentId}" sets compaction.provider: "lossless-claw", which is deprecated in ` +
          "favour of plugins.slots.contextEngine. It still parses, so this is non-fatal — but it " +
          "is only migrated for Codex-runtime agents.",
        fix: MIGRATION_FIX,
      });
    }
  }

  return results;
}
