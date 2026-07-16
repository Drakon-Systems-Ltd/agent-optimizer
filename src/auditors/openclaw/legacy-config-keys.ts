import type { AuditResult, OpenClawConfig } from "../../types.js";

// Legacy config paths that OpenClaw's doctor migrates (2026.5–2026.7 window).
// Source: src/commands/doctor/shared/legacy-config-migrations.*.ts and
// src/config/web-search-legacy-provider-keys.ts in OpenClaw 2026.7.1.

const LEGACY_TOP_LEVEL: Array<{ key: string; target: string }> = [
  { key: "memorySearch", target: "agents.defaults.memorySearch" },
  { key: "heartbeat", target: "agents.defaults.heartbeat" },
  { key: "routing", target: "channel config (channels.*, dmPolicy/groupPolicy)" },
  { key: "canvasHost", target: "surfaces" },
];

const LEGACY_DEFAULTS_KEYS: Array<{ key: string; note: string }> = [
  { key: "embeddedPi", note: "Pi runtime was internalized — remove; runtime is set per-agent via agents.list[].runtime" },
  { key: "embeddedHarness", note: "removed — runtime is set per-agent via agents.list[].runtime" },
  { key: "agentRuntime", note: "removed — use agents.list[].runtime" },
  { key: "llm", note: "removed — use agents.defaults.model" },
  { key: "silentReplyRewrite", note: "removed — use agents.defaults.silentReply" },
];

// Legacy tools.web.search.<provider> blocks — moved to
// plugins.entries.<plugin>.config.webSearch.
const LEGACY_WEB_SEARCH_PROVIDERS = [
  "brave", "duckduckgo", "exa", "firecrawl", "gemini", "grok",
  "kimi", "minimax", "ollama", "perplexity", "searxng", "tavily",
];

export function auditLegacyConfigKeys(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];
  const doctorFix = "Run: openclaw doctor --fix (migrates legacy keys in place)";

  for (const { key, target } of LEGACY_TOP_LEVEL) {
    if (key in config && config[key] != null) {
      results.push({
        category: "Legacy Config",
        check: `Top-level ${key}`,
        status: "warn",
        message: `Top-level "${key}" is a legacy location — current OpenClaw reads ${target}`,
        fix: doctorFix,
      });
    }
  }

  const defaults = config.agents?.defaults as Record<string, unknown> | undefined;
  if (defaults) {
    for (const { key, note } of LEGACY_DEFAULTS_KEYS) {
      if (key in defaults && defaults[key] != null) {
        results.push({
          category: "Legacy Config",
          check: `agents.defaults.${key}`,
          status: "warn",
          message: `agents.defaults.${key} is a removed legacy key — ${note}`,
          fix: doctorFix,
        });
      }
    }
  }

  const session = config.session as Record<string, unknown> | undefined;
  if (session && typeof session === "object") {
    const maintenance = session.maintenance as Record<string, unknown> | undefined;
    if (maintenance && typeof maintenance === "object" && maintenance.pruneDays != null) {
      results.push({
        category: "Legacy Config",
        check: "session.maintenance.pruneDays",
        status: "warn",
        message: "session.maintenance.pruneDays is deprecated — use session.maintenance.pruneAfter",
        fix: "Rename pruneDays to pruneAfter (interval string, e.g. \"30d\")",
      });
    }
    if (session.threadBindings != null) {
      results.push({
        category: "Legacy Config",
        check: "session.threadBindings",
        status: "warn",
        message: "session.threadBindings is a legacy key with a doctor migration",
        fix: doctorFix,
      });
    }
  }

  const gateway = config.gateway as Record<string, unknown> | undefined;
  if (gateway && typeof gateway === "object" && gateway.webchat != null) {
    results.push({
      category: "Legacy Config",
      check: "gateway.webchat",
      status: "warn",
      message: "gateway.webchat is a legacy key — Control UI config moved under gateway.controlUi",
      fix: doctorFix,
    });
  }

  const webSearch = (config.tools as Record<string, unknown> | undefined)?.web as
    | { search?: Record<string, unknown> }
    | undefined;
  if (webSearch?.search && typeof webSearch.search === "object") {
    const legacyBlocks = LEGACY_WEB_SEARCH_PROVIDERS.filter(
      (p) => webSearch.search![p] != null
    );
    if (legacyBlocks.length > 0) {
      results.push({
        category: "Legacy Config",
        check: "Web search provider blocks",
        status: "warn",
        message: `tools.web.search.{${legacyBlocks.join(", ")}} are legacy provider blocks — provider config moved to plugins.entries.<plugin>.config.webSearch`,
        fix: doctorFix,
      });
    }
  }

  return results;
}
