import type { AuditResult, OpenClawConfig } from "../types.js";
import { parseInterval } from "../utils/config.js";

const LOCAL_PROVIDERS = ["lm-studio", "ollama"];

// Typical context window sizes for popular local models
const SMALL_CONTEXT_MODELS: Record<string, number> = {
  "llama": 8192,
  "mistral": 32768,
  "phi": 4096,
  "gemma": 8192,
  "qwen": 32768,
};

function isLocalModel(model: string): boolean {
  const provider = model.split("/")[0];
  return LOCAL_PROVIDERS.includes(provider);
}

export function auditLocalModels(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];
  const defaults = config.agents?.defaults;
  if (!defaults?.model?.primary) return results;

  const primary = defaults.model.primary;
  const fallbacks = defaults.model.fallbacks ?? [];
  const allModels = [primary, ...fallbacks];
  const hasLocalPrimary = isLocalModel(primary);
  const hasAnyLocal = allModels.some(isLocalModel);

  // Only run if local models are in use
  if (!hasAnyLocal) return results;

  // --- localModelLean recommendation ---

  const experimental = (defaults as Record<string, unknown>).experimental as
    Record<string, unknown> | undefined;
  const localModelLean = experimental?.localModelLean;

  if (hasLocalPrimary) {
    if (localModelLean === true) {
      results.push({
        category: "Local Models",
        check: "Lean mode",
        status: "pass",
        message: "localModelLean enabled — heavyweight tools (browser, cron, message) dropped from prompt",
      });
    } else {
      results.push({
        category: "Local Models",
        check: "Lean mode",
        status: "warn",
        message: "Local model as primary but localModelLean not enabled — full tool prompt may exceed model capacity",
        fix: "Set agents.defaults.experimental.localModelLean to true to reduce prompt size",
      });
    }
  }

  // --- Context window vs local model capacity ---

  const contextTokens = defaults.contextTokens ?? 200000;

  if (hasLocalPrimary && contextTokens > 32000) {
    results.push({
      category: "Local Models",
      check: "Context window size",
      status: "warn",
      message: `contextTokens is ${(contextTokens / 1000).toFixed(0)}K but most local models have 4K-32K context — tokens beyond the model's window are silently dropped`,
      fix: "Set contextTokens to match your model's actual context window (e.g. 8192 for Llama, 32768 for Mistral)",
    });
  } else if (hasLocalPrimary) {
    results.push({
      category: "Local Models",
      check: "Context window size",
      status: "pass",
      message: `contextTokens: ${(contextTokens / 1000).toFixed(0)}K — reasonable for local models`,
    });
  }

  // --- Compaction reserve vs context window ---

  const compaction = defaults.compaction;
  const reserveFloor = compaction?.reserveTokensFloor;

  if (hasLocalPrimary && reserveFloor != null && reserveFloor > contextTokens) {
    results.push({
      category: "Local Models",
      check: "Compaction reserve overflow",
      status: "fail",
      message: `reserveTokensFloor (${reserveFloor}) exceeds contextTokens (${contextTokens}) — compaction will never trigger`,
      fix: `Reduce reserveTokensFloor below contextTokens (v2026.4.14+ auto-caps this, but explicit config overrides the cap)`,
    });
  } else if (hasLocalPrimary && reserveFloor != null && reserveFloor > contextTokens * 0.5) {
    results.push({
      category: "Local Models",
      check: "Compaction reserve ratio",
      status: "warn",
      message: `reserveTokensFloor (${reserveFloor}) is over 50% of contextTokens (${contextTokens}) — leaves little room for conversation history`,
      fix: "Set reserveTokensFloor to 20-30% of contextTokens",
    });
  }

  // --- Subagent concurrency for local models ---

  const subagentMax = defaults.subagents?.maxConcurrent ?? 4;

  if (hasLocalPrimary && subagentMax > 2) {
    results.push({
      category: "Local Models",
      check: "Subagent concurrency",
      status: "warn",
      message: `subagents.maxConcurrent is ${subagentMax} — local models typically can't handle concurrent inference`,
      fix: "Reduce to 1-2 for local models to avoid OOM or queue starvation",
    });
  }

  // --- Heartbeat frequency for local models ---

  const heartbeat = defaults.heartbeat?.every;
  if (hasLocalPrimary && heartbeat) {
    const seconds = parseInterval(heartbeat);
    if (seconds > 0 && seconds < 3600) {
      results.push({
        category: "Local Models",
        check: "Heartbeat frequency",
        status: "warn",
        message: `Heartbeat every ${heartbeat} is aggressive for local inference — each heartbeat queues a full inference pass`,
        fix: "Increase heartbeat to 6h+ for local models, or disable if not needed",
      });
    }
  }

  // --- Thinking mode compatibility ---

  const thinking = defaults.thinkingDefault;
  if (hasLocalPrimary && thinking && thinking !== "off") {
    results.push({
      category: "Local Models",
      check: "Thinking mode",
      status: "info",
      message: `thinkingDefault "${thinking}" set with local model — most local models ignore thinking directives`,
    });
  }

  // --- Fallback chain: local-only risk ---

  const allLocal = allModels.every(isLocalModel);
  if (allLocal && allModels.length > 1) {
    results.push({
      category: "Local Models",
      check: "Fallback resilience",
      status: "info",
      message: "All models (primary + fallbacks) are local — if the host goes down or runs out of VRAM, no cloud fallback available",
    });
  }

  // --- Mixed local/cloud: cost escalation ---

  if (hasLocalPrimary && !allLocal) {
    const cloudFallbacks = fallbacks.filter((f) => !isLocalModel(f));
    results.push({
      category: "Local Models",
      check: "Cloud fallback",
      status: "pass",
      message: `Local primary with ${cloudFallbacks.length} cloud fallback(s) — good resilience`,
    });
  }

  return results;
}
