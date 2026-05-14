import type { AuditResult, OpenClawConfig } from "../../types.js";
import { parseInterval } from "../../utils/config.js";

export function auditTokenEfficiency(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];
  const defaults = config.agents?.defaults;
  if (!defaults) return results;

  // Context window size
  const contextTokens = defaults.contextTokens ?? 200000;
  if (contextTokens > 500000) {
    results.push({
      category: "Token Efficiency",
      check: "Context window size",
      status: "warn",
      message: `contextTokens is ${(contextTokens / 1000).toFixed(0)}K — very large, burns tokens on every turn`,
      fix: "Consider reducing to 200K unless you need deep history",
    });
  } else {
    results.push({
      category: "Token Efficiency",
      check: "Context window size",
      status: "pass",
      message: `contextTokens: ${(contextTokens / 1000).toFixed(0)}K`,
    });
  }

  // Heartbeat frequency
  const heartbeat = defaults.heartbeat?.every;
  if (heartbeat) {
    const seconds = parseInterval(heartbeat);
    if (seconds > 0 && seconds < 7200) {
      const perDay = Math.round(86400 / seconds);
      results.push({
        category: "Token Efficiency",
        check: "Heartbeat frequency",
        status: "warn",
        message: `Heartbeat every ${heartbeat} = ~${perDay} turns/day of idle token burn`,
        fix: "Increase to 6h+ unless frequent heartbeats are needed",
      });
    } else {
      results.push({
        category: "Token Efficiency",
        check: "Heartbeat frequency",
        status: "pass",
        message: `Heartbeat: ${heartbeat}`,
      });
    }
  }

  // Subagent concurrency
  const subagentMax = defaults.subagents?.maxConcurrent ?? 4;
  if (subagentMax > 6) {
    results.push({
      category: "Token Efficiency",
      check: "Subagent concurrency",
      status: "warn",
      message: `subagents.maxConcurrent is ${subagentMax} — each subagent is a full context window`,
      fix: "Reduce to 4-6 unless you need heavy parallelism",
    });
  } else {
    results.push({
      category: "Token Efficiency",
      check: "Subagent concurrency",
      status: "pass",
      message: `Subagent concurrency: ${subagentMax}`,
    });
  }

  // Compaction mode
  const compaction = defaults.compaction;
  if (!compaction) {
    results.push({
      category: "Token Efficiency",
      check: "Compaction configured",
      status: "warn",
      message: "No compaction settings — history may grow unbounded",
      fix: 'Set agents.defaults.compaction.mode to "safeguard"',
    });
  } else {
    results.push({
      category: "Token Efficiency",
      check: "Compaction configured",
      status: "pass",
      message: `Compaction mode: ${compaction.mode ?? "default"}`,
    });
  }

  // Context pruning
  const pruning = defaults.contextPruning;
  if (!pruning) {
    results.push({
      category: "Token Efficiency",
      check: "Context pruning",
      status: "warn",
      message: "No context pruning configured",
      fix: 'Set agents.defaults.contextPruning.mode to "cache-ttl" with a reasonable TTL',
    });
  } else {
    results.push({
      category: "Token Efficiency",
      check: "Context pruning",
      status: "pass",
      message: `Pruning: ${pruning.mode} (TTL: ${pruning.ttl ?? "default"})`,
    });
  }

  return results;
}
