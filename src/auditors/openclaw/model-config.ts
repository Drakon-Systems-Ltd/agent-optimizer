import type { AuditResult, OpenClawConfig } from "../../types.js";

const VALID_THINKING_DEFAULTS = [
  "off", "minimal", "low", "medium", "high", "xhigh", "adaptive",
];

// Models with known aliases that should be canonicalized
const MODEL_ALIASES: Record<string, { canonical: string; reason: string }> = {
  "openai-codex/gpt-5.4-codex": {
    canonical: "openai-codex/gpt-5.4",
    reason: "legacy alias canonicalized in v2026.4.14",
  },
};

// Models that don't support xhigh thinking
const NO_XHIGH_THINKING = [
  "openai/gpt-4o-mini",
  "deepseek/deepseek-chat",
  "google-ai/gemini-2.5-flash",
];

// Models where "minimal" thinking maps to "low" (OpenAI-compat)
const MINIMAL_MAPS_TO_LOW = [
  "openai/gpt-5.4",
  "openai-codex/gpt-5.4",
  "codex/gpt-5.4",
  "openai/gpt-5.4-pro",
  "openai-codex/gpt-5.4-pro",
  "codex/gpt-5.4-pro",
  "openai/gpt-4o",
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

  // Check for legacy model aliases
  const allModels = [defaults.model.primary, ...fallbacks];
  for (const model of allModels) {
    const alias = MODEL_ALIASES[model];
    if (alias) {
      results.push({
        category: "Model Config",
        check: `Model alias: ${model}`,
        status: "warn",
        message: `"${model}" is a legacy alias — ${alias.reason}`,
        fix: `Replace with "${alias.canonical}"`,
        autoFixable: true,
      });
    }
  }

  // Check thinkingDefault compatibility with primary model
  if (defaults.thinkingDefault && defaults.model.primary) {
    const thinking = defaults.thinkingDefault;
    const primary = defaults.model.primary;

    if (thinking === "xhigh" && NO_XHIGH_THINKING.some((m) => primary.startsWith(m))) {
      results.push({
        category: "Model Config",
        check: "thinkingDefault compatibility",
        status: "warn",
        message: `thinkingDefault "xhigh" is not supported by ${primary} — will be downgraded or ignored`,
        fix: 'Use "high" or "adaptive" instead',
      });
    }

    if (thinking === "minimal" && MINIMAL_MAPS_TO_LOW.some((m) => primary === m || primary.startsWith(m))) {
      results.push({
        category: "Model Config",
        check: "thinkingDefault mapping",
        status: "info",
        message: `"minimal" thinking maps to "low" for ${primary} (OpenAI-compatible models)`,
      });
    }
  }

  // Check for unknown config keys that crash the gateway
  const knownDefaults = [
    "model", "models", "workspace", "contextTokens", "contextPruning",
    "compaction", "heartbeat", "maxConcurrent", "subagents", "thinkingDefault",
    "envelopeTimezone", "envelopeTimestamp", "memorySearch", "imageGenerationModel",
    "imageMaxDimensionPx", "fastMode", "dreaming", "activeMemory", "execPolicy",
    "dmScope", "memory", "experimental", "timeoutSeconds",
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
