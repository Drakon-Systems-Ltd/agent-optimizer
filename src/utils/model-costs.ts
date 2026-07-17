import { LOCAL_PROVIDERS, SUBSCRIPTION_PROVIDERS } from "./providers.js";

// Single source of truth for model pricing and provider latency, shared by the
// cost estimator and provider-failover auditors.

export interface ModelCost {
  input: number; // USD per MTok
  output: number;
  cached: number; // cache-read rate (~0.1x input for Anthropic)
}

function cost(input: number, output: number, cached?: number): ModelCost {
  return { input, output, cached: cached ?? input * 0.1 };
}

// Anthropic API pricing per the Claude API docs (2026-06): Fable/Mythos 5
// $10/$50, Opus 4.5–4.8 $5/$25, Sonnet 4.5–5 $3/$15, Haiku 4.5 $1/$5.
const ANTHROPIC_COSTS: Record<string, ModelCost> = {
  "claude-fable-5": cost(10, 50),
  "claude-mythos-5": cost(10, 50),
  "claude-opus-4-8": cost(5, 25),
  "claude-opus-4-7": cost(5, 25),
  "claude-opus-4-6": cost(5, 25),
  "claude-opus-4-5": cost(5, 25),
  "claude-sonnet-5": cost(3, 15),
  "claude-sonnet-4-6": cost(3, 15),
  "claude-sonnet-4-5": cost(3, 15),
  "claude-haiku-4-5": cost(1, 5),
};

// Non-Anthropic entries are rough public prices; unlisted models simply get
// "no pricing data" from the estimator rather than an invented number.
const MODEL_COSTS: Record<string, ModelCost> = {
  ...Object.fromEntries(
    Object.entries(ANTHROPIC_COSTS).map(([m, c]) => [`anthropic/${m}`, c])
  ),
  "openai/gpt-4o": cost(2.5, 10, 1.25),
  "openai/gpt-4o-mini": cost(0.15, 0.6, 0.075),
  "openrouter/moonshotai/kimi-k2.5": cost(1.0, 4.0),
  "google-ai/gemini-2.5-flash": cost(0.15, 0.6, 0.04),
  "deepseek/deepseek-chat": cost(0.28, 0.42, 0.028),
  "xai/grok-4-0709": cost(3, 15),
};

const ZERO_COST: ModelCost = { input: 0, output: 0, cached: 0 };

/**
 * Resolve pricing for a "provider/model" ref.
 * - Subscription providers (claude-cli, openai-codex, codex, github-copilot)
 *   and local providers (ollama, lm-studio, ...) are $0 regardless of model.
 * - Unknown providers serving a known Anthropic model id (e.g. a plugin
 *   provider like "clawd/claude-fable-5") fall back to Anthropic API pricing
 *   as a best-effort estimate.
 * - Otherwise null: no pricing data.
 */
export function getModelCost(model: string): ModelCost | null {
  const direct = MODEL_COSTS[model];
  if (direct) return direct;

  const provider = model.split("/")[0];
  if (SUBSCRIPTION_PROVIDERS.has(provider) || LOCAL_PROVIDERS.has(provider)) {
    return ZERO_COST;
  }

  const bareModel = model.slice(provider.length + 1);
  return ANTHROPIC_COSTS[bareModel] ?? null;
}

/** True when the ref resolves to a $0 (subscription/local) model. */
export function isZeroCost(model: string): boolean {
  const c = getModelCost(model);
  return !!c && c.input === 0 && c.output === 0;
}

// Rough provider latency tiers for failover-chain analysis.
export const PROVIDER_LATENCY: Record<string, "fast" | "medium" | "slow"> = {
  anthropic: "fast",
  "claude-cli": "fast",
  openai: "fast",
  "openai-codex": "fast",
  codex: "fast",
  "github-copilot": "fast",
  google: "fast",
  "google-ai": "fast",
  "lm-studio": "fast", // local
  ollama: "fast", // local
  openrouter: "medium",
  deepseek: "medium",
  xai: "medium",
  arcee: "slow",
};
