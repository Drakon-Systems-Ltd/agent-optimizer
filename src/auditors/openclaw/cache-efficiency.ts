import type { AuditResult, OpenClawConfig } from "../../types.js";
import { parseInterval } from "../../utils/config.js";

// Anthropic cache TTL is 5 minutes
const ANTHROPIC_CACHE_TTL_SECONDS = 300;

export function auditCacheEfficiency(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];
  const defaults = config.agents?.defaults;
  if (!defaults) return results;

  const primary = defaults.model?.primary ?? "";
  const isAnthropic = primary.includes("anthropic") || primary.includes("claude");

  // Check cacheRetention setting
  const models = defaults.models ?? {};
  const primaryModelConfig = models[primary];
  const cacheRetention = (primaryModelConfig as Record<string, unknown>)?.cacheRetention as string | undefined;

  if (isAnthropic) {
    if (!cacheRetention) {
      results.push({
        category: "Cache Efficiency",
        check: "cacheRetention configured",
        status: "warn",
        message: "No cacheRetention set for Anthropic model — defaulting to provider behaviour",
        fix: `Set agents.defaults.models["${primary}"].cacheRetention to "short" or "long"`,
      });
    } else if (cacheRetention === "none") {
      results.push({
        category: "Cache Efficiency",
        check: "cacheRetention mode",
        status: "warn",
        message: 'cacheRetention is "none" — every turn pays full input cost with no cache benefit',
        fix: 'Set to "short" for 5-min cache or "long" for extended cache',
      });
    } else {
      results.push({
        category: "Cache Efficiency",
        check: "cacheRetention mode",
        status: "pass",
        message: `cacheRetention: ${cacheRetention}`,
      });
    }
  }

  // Check heartbeat vs cache TTL alignment
  const heartbeatStr = defaults.heartbeat?.every ?? "";
  const heartbeatSeconds = heartbeatStr ? parseInterval(heartbeatStr) : 0;
  const pruningMode = defaults.contextPruning?.mode;
  const pruningTtl = defaults.contextPruning?.ttl ?? "";
  const pruningTtlSeconds = pruningTtl ? parseInterval(pruningTtl) : 0;

  if (isAnthropic && heartbeatSeconds > 0) {
    if (heartbeatSeconds > ANTHROPIC_CACHE_TTL_SECONDS && heartbeatSeconds < 600) {
      // Heartbeat is between 5-10 minutes — worst zone
      results.push({
        category: "Cache Efficiency",
        check: "Heartbeat vs cache TTL",
        status: "warn",
        message: `Heartbeat (${heartbeatStr}) exceeds Anthropic 5-min cache TTL but is under 10min — cache expires between heartbeats, each one pays full cost`,
        fix: `Either reduce heartbeat below 5min (keeps cache warm) or increase to 1h+ (accepts cache miss, fewer total turns)`,
      });
    } else if (heartbeatSeconds <= ANTHROPIC_CACHE_TTL_SECONDS && heartbeatSeconds > 0) {
      results.push({
        category: "Cache Efficiency",
        check: "Heartbeat vs cache TTL",
        status: "pass",
        message: `Heartbeat (${heartbeatStr}) keeps Anthropic cache warm (under 5min TTL)`,
      });
    } else if (heartbeatSeconds >= 3600) {
      results.push({
        category: "Cache Efficiency",
        check: "Heartbeat vs cache TTL",
        status: "pass",
        message: `Heartbeat (${heartbeatStr}) — cache will miss but fewer total turns saves more overall`,
      });
    }
  }

  // Check context pruning alignment
  if (pruningMode === "cache-ttl") {
    results.push({
      category: "Cache Efficiency",
      check: "Context pruning mode",
      status: "pass",
      message: `cache-ttl pruning enabled (TTL: ${pruningTtl || "default"})`,
    });

    // Check if pruning TTL is too aggressive or too lenient
    if (pruningTtlSeconds > 0 && pruningTtlSeconds < 1800) {
      results.push({
        category: "Cache Efficiency",
        check: "Pruning TTL",
        status: "warn",
        message: `Pruning TTL (${pruningTtl}) is very aggressive — may lose recent context too quickly`,
        fix: "Consider 1h-2h for most workloads",
      });
    } else if (pruningTtlSeconds > 14400) {
      results.push({
        category: "Cache Efficiency",
        check: "Pruning TTL",
        status: "warn",
        message: `Pruning TTL (${pruningTtl}) is very long — context accumulates and burns tokens`,
        fix: "Consider 2h-4h to balance context retention vs cost",
      });
    }
  } else if (!pruningMode) {
    results.push({
      category: "Cache Efficiency",
      check: "Context pruning mode",
      status: "warn",
      message: "No context pruning configured — stale turns remain in context forever",
      fix: 'Set agents.defaults.contextPruning.mode to "cache-ttl" with ttl: "2h"',
    });
  }

  // Check lightContext on heartbeat
  const lightContext = defaults.heartbeat?.lightContext;
  if (heartbeatSeconds > 0 && heartbeatSeconds < 3600 && !lightContext) {
    results.push({
      category: "Cache Efficiency",
      check: "Heartbeat light context",
      status: "warn",
      message: "Frequent heartbeats without lightContext send full context each time",
      fix: "Set agents.defaults.heartbeat.lightContext to true",
    });
  } else if (lightContext) {
    results.push({
      category: "Cache Efficiency",
      check: "Heartbeat light context",
      status: "pass",
      message: "lightContext enabled — heartbeats use minimal context",
    });
  }

  // Check compaction model cost
  const compactionModel = defaults.compaction?.model;
  if (compactionModel) {
    const isExpensive = compactionModel.includes("opus") || compactionModel.includes("gpt-4o");
    if (isExpensive) {
      results.push({
        category: "Cache Efficiency",
        check: "Compaction model cost",
        status: "warn",
        message: `Compaction uses ${compactionModel} — expensive model for summarization`,
        fix: "Use a cheaper model for compaction (sonnet, haiku, or flash)",
      });
    } else {
      results.push({
        category: "Cache Efficiency",
        check: "Compaction model cost",
        status: "pass",
        message: `Compaction model: ${compactionModel}`,
      });
    }
  }

  return results;
}
