import type { AuditResult, OpenClawConfig } from "../types.js";

const VALID_THINKING_DEFAULTS = [
  "off", "minimal", "low", "medium", "high", "xhigh", "adaptive",
];

export function auditModelConfig(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];
  const defaults = config.agents?.defaults;

  if (!defaults?.model?.primary) {
    results.push({
      category: "Model Config",
      check: "Primary model set",
      status: "fail",
      message: "No primary model configured",
      fix: 'Set agents.defaults.model.primary (e.g. "anthropic/claude-sonnet-4-6")',
    });
    return results;
  }

  results.push({
    category: "Model Config",
    check: "Primary model set",
    status: "pass",
    message: `Primary: ${defaults.model.primary}`,
  });

  // Check fallbacks
  const fallbacks = defaults.model.fallbacks ?? [];
  if (fallbacks.length === 0) {
    results.push({
      category: "Model Config",
      check: "Fallback models",
      status: "warn",
      message: "No fallback models configured — if primary fails, agent stops",
      fix: "Add fallback models to agents.defaults.model.fallbacks",
    });
  } else {
    // Check for duplicate of primary in fallbacks
    if (fallbacks.includes(defaults.model.primary)) {
      results.push({
        category: "Model Config",
        check: "Fallback duplication",
        status: "warn",
        message: `Primary model "${defaults.model.primary}" also listed in fallbacks — wastes a fallback slot`,
        fix: "Remove primary model from fallbacks array",
        autoFixable: true,
      });
    }

    // Check for cross-provider fallbacks
    const primaryProvider = defaults.model.primary.split("/")[0];
    const hasOtherProvider = fallbacks.some(
      (f) => f.split("/")[0] !== primaryProvider
    );
    if (!hasOtherProvider) {
      results.push({
        category: "Model Config",
        check: "Cross-provider fallback",
        status: "warn",
        message: "All fallbacks use the same provider — if provider goes down, all fail",
        fix: "Add a fallback from a different provider",
      });
    } else {
      results.push({
        category: "Model Config",
        check: "Cross-provider fallback",
        status: "pass",
        message: "Fallbacks include multiple providers",
      });
    }
  }

  // Check thinkingDefault
  if (defaults.thinkingDefault) {
    if (!VALID_THINKING_DEFAULTS.includes(defaults.thinkingDefault)) {
      results.push({
        category: "Model Config",
        check: "thinkingDefault value",
        status: "fail",
        message: `Invalid thinkingDefault: "${defaults.thinkingDefault}" — will crash gateway`,
        fix: `Set to one of: ${VALID_THINKING_DEFAULTS.join(", ")}`,
        autoFixable: true,
      });
    } else {
      results.push({
        category: "Model Config",
        check: "thinkingDefault value",
        status: "pass",
        message: `thinkingDefault: ${defaults.thinkingDefault}`,
      });
    }
  }

  // Check for unknown config keys that crash the gateway
  const knownDefaults = [
    "model", "models", "workspace", "contextTokens", "contextPruning",
    "compaction", "heartbeat", "maxConcurrent", "subagents", "thinkingDefault",
    "envelopeTimezone", "envelopeTimestamp", "memorySearch", "imageGenerationModel",
    "imageMaxDimensionPx", "fastMode", "dreaming", "activeMemory", "execPolicy",
    "dmScope", "memory",
  ];
  if (defaults) {
    const unknown = Object.keys(defaults).filter(
      (k) => !knownDefaults.includes(k)
    );
    if (unknown.length > 0) {
      results.push({
        category: "Model Config",
        check: "Unknown config keys",
        status: "warn",
        message: `Unknown keys in agents.defaults: ${unknown.join(", ")} — may crash gateway`,
        fix: "Remove unrecognized keys",
      });
    }
  }

  return results;
}
