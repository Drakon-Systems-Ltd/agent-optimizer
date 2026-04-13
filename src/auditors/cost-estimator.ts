import type { AuditResult, OpenClawConfig } from "../types.js";
import { parseInterval, loadModelsJson, expandPath } from "../utils/config.js";

// Approximate token costs per million tokens (USD) for common models
const MODEL_COSTS: Record<string, { input: number; output: number; cached?: number }> = {
  "anthropic/claude-opus-4-6": { input: 15, output: 75, cached: 1.5 },
  "anthropic/claude-opus-4-5": { input: 15, output: 75, cached: 1.5 },
  "anthropic/claude-sonnet-4-6": { input: 3, output: 15, cached: 0.3 },
  "anthropic/claude-sonnet-4-5": { input: 3, output: 15, cached: 0.3 },
  "anthropic/claude-haiku-4-5": { input: 0.8, output: 4, cached: 0.08 },
  "claude-cli/claude-opus-4-6": { input: 0, output: 0 }, // subscription
  "claude-cli/claude-sonnet-4-6": { input: 0, output: 0 }, // subscription
  "claude-cli/claude-sonnet-4-5": { input: 0, output: 0 }, // subscription
  "openai-codex/gpt-5.4": { input: 0, output: 0 }, // subscription
  "openai/gpt-4o": { input: 2.5, output: 10, cached: 1.25 },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6, cached: 0.075 },
  "openrouter/moonshotai/kimi-k2.5": { input: 1.0, output: 4.0 },
  "google-ai/gemini-2.5-flash": { input: 0.15, output: 0.6, cached: 0.04 },
  "deepseek/deepseek-chat": { input: 0.28, output: 0.42, cached: 0.028 },
  "xai/grok-4-0709": { input: 3, output: 15 },
};

// Average tokens per turn (rough estimates)
const AVG_INPUT_TOKENS_PER_TURN = 8000; // system prompt + context + user message
const AVG_OUTPUT_TOKENS_PER_TURN = 2000;
const CACHE_HIT_RATE = 0.6; // 60% cache hit on system prompt

function getModelCost(model: string): { input: number; output: number; cached: number } | null {
  const direct = MODEL_COSTS[model];
  if (direct) return { input: direct.input, output: direct.output, cached: direct.cached ?? direct.input };

  // Check models.json for cost overrides
  return null;
}

function estimateMonthlyCost(
  model: string,
  contextTokens: number,
  heartbeatSeconds: number,
  turnsPerDay: number,
): { monthly: number; breakdown: string } | null {
  const cost = getModelCost(model);
  if (!cost) return null;
  if (cost.input === 0 && cost.output === 0) return null; // subscription model

  // Scale input tokens based on context window (larger context = more tokens per turn)
  const contextMultiplier = Math.min(contextTokens / 200000, 5);
  const scaledInput = AVG_INPUT_TOKENS_PER_TURN * contextMultiplier;

  // Heartbeat turns per day
  const heartbeatTurnsPerDay = heartbeatSeconds > 0 ? Math.floor(86400 / heartbeatSeconds) : 0;
  const totalTurnsPerDay = turnsPerDay + heartbeatTurnsPerDay;

  // Monthly calculation
  const daysPerMonth = 30;
  const monthlyTurns = totalTurnsPerDay * daysPerMonth;

  // Cost per turn (with cache hits on input)
  const cachedInputTokens = scaledInput * CACHE_HIT_RATE;
  const uncachedInputTokens = scaledInput * (1 - CACHE_HIT_RATE);
  const inputCostPerTurn = (uncachedInputTokens * cost.input + cachedInputTokens * cost.cached) / 1_000_000;
  const outputCostPerTurn = (AVG_OUTPUT_TOKENS_PER_TURN * cost.output) / 1_000_000;
  const costPerTurn = inputCostPerTurn + outputCostPerTurn;

  const monthly = costPerTurn * monthlyTurns;
  const breakdown = `${monthlyTurns} turns/mo × $${costPerTurn.toFixed(4)}/turn (${scaledInput.toFixed(0)} input + ${AVG_OUTPUT_TOKENS_PER_TURN} output tokens)`;

  return { monthly, breakdown };
}

export function auditCostEstimate(config: OpenClawConfig, agentDir?: string): AuditResult[] {
  const results: AuditResult[] = [];
  const defaults = config.agents?.defaults;
  if (!defaults) return results;

  const primary = defaults.model?.primary;
  if (!primary) return results;

  const contextTokens = defaults.contextTokens ?? 200000;
  const heartbeatStr = defaults.heartbeat?.every ?? "1h";
  const heartbeatSeconds = parseInterval(heartbeatStr);

  // Estimate for primary model
  const estimate = estimateMonthlyCost(primary, contextTokens, heartbeatSeconds, 10);

  if (!estimate) {
    const cost = getModelCost(primary);
    if (cost && cost.input === 0) {
      results.push({
        category: "Cost Estimate",
        check: "Primary model cost",
        status: "pass",
        message: `${primary} uses subscription billing — no per-token cost`,
      });
    } else {
      results.push({
        category: "Cost Estimate",
        check: "Primary model cost",
        status: "info",
        message: `No pricing data for ${primary} — cannot estimate costs`,
      });
    }
  } else {
    const monthlyUsd = estimate.monthly;
    const monthlyGbp = monthlyUsd * 0.79; // rough USD to GBP

    results.push({
      category: "Cost Estimate",
      check: "Estimated monthly cost",
      status: monthlyGbp > 100 ? "warn" : monthlyGbp > 30 ? "info" : "pass",
      message: `~£${monthlyGbp.toFixed(0)}/month ($${monthlyUsd.toFixed(0)}) on ${primary}`,
    });

    results.push({
      category: "Cost Estimate",
      check: "Cost breakdown",
      status: "info",
      message: estimate.breakdown,
    });

    // Calculate savings with balanced profile
    const optimizedEstimate = estimateMonthlyCost(primary, 200000, 21600, 10); // 200K context, 6h heartbeat
    if (optimizedEstimate && optimizedEstimate.monthly < estimate.monthly) {
      const savingsUsd = estimate.monthly - optimizedEstimate.monthly;
      const savingsGbp = savingsUsd * 0.79;
      const savingsPercent = ((savingsUsd / estimate.monthly) * 100).toFixed(0);

      results.push({
        category: "Cost Estimate",
        check: "Potential savings (balanced profile)",
        status: "warn",
        message: `Save ~£${savingsGbp.toFixed(0)}/month (${savingsPercent}%) by optimizing context window and heartbeat`,
        fix: "Run: agent-optimizer optimize --profile balanced",
      });
    }
  }

  // Check fallback costs
  const fallbacks = defaults.model?.fallbacks ?? [];
  for (const fb of fallbacks) {
    const fbCost = getModelCost(fb);
    if (fbCost && fbCost.input > 10) {
      results.push({
        category: "Cost Estimate",
        check: `Fallback cost: ${fb}`,
        status: "warn",
        message: `Expensive fallback: $${fbCost.input}/$${fbCost.output} per MTok — could spike costs if primary fails`,
      });
    }
  }

  // Check if subscription models are available but not primary
  const isSubscription = primary.startsWith("claude-cli/") || primary.startsWith("openai-codex/");
  if (!isSubscription && estimate) {
    const hasSubFallback = fallbacks.some((f) => f.startsWith("claude-cli/") || f.startsWith("openai-codex/"));
    if (hasSubFallback) {
      results.push({
        category: "Cost Estimate",
        check: "Subscription model available",
        status: "warn",
        message: `You have subscription models in fallbacks but pay-per-token as primary — consider switching to save ~£${(estimate.monthly * 0.79).toFixed(0)}/month`,
        fix: `Switch primary to a claude-cli/ or openai-codex/ model`,
      });
    }
  }

  return results;
}
