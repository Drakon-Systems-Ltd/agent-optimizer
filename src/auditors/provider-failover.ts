import type { AuditResult, OpenClawConfig } from "../types.js";
import { loadAuthProfiles, loadModelsJson, expandPath } from "../utils/config.js";

// Known provider latency tiers (rough)
const PROVIDER_LATENCY: Record<string, "fast" | "medium" | "slow"> = {
  "anthropic": "fast",
  "claude-cli": "fast",
  "openai": "fast",
  "openai-codex": "fast",
  "openrouter": "medium",
  "google-ai": "fast",
  "google": "fast",
  "deepseek": "medium",
  "xai": "medium",
  "codex": "fast",
  "github-copilot": "fast",
  "lm-studio": "fast", // local
  "ollama": "fast", // local
  "arcee": "slow",
};

// Known cost tiers per MTok input (rough USD)
const PROVIDER_COST: Record<string, number> = {
  "anthropic/claude-opus-4-6": 15,
  "anthropic/claude-opus-4-5": 15,
  "anthropic/claude-sonnet-4-6": 3,
  "anthropic/claude-sonnet-4-5": 3,
  "anthropic/claude-haiku-4-5": 0.8,
  "claude-cli/claude-opus-4-6": 0,
  "claude-cli/claude-sonnet-4-6": 0,
  "claude-cli/claude-sonnet-4-5": 0,
  "claude-cli/claude-haiku-4-5": 0,
  "openai-codex/gpt-5.4": 0,
  "openai-codex/gpt-5.4-pro": 0,
  "codex/gpt-5.4": 0,
  "codex/gpt-5.4-pro": 0,
  "codex/gpt-4o": 0,
  "github-copilot/gpt-5.4": 0,
  "openai/gpt-4o": 2.5,
  "openai/gpt-4o-mini": 0.15,
  "openrouter/moonshotai/kimi-k2.5": 1.0,
  "google-ai/gemini-2.5-flash": 0.15,
  "deepseek/deepseek-chat": 0.28,
  "xai/grok-4-0709": 3,
};

function getProvider(model: string): string {
  return model.split("/")[0];
}

export function auditProviderFailover(config: OpenClawConfig, agentDir: string): AuditResult[] {
  const results: AuditResult[] = [];
  const defaults = config.agents?.defaults;
  if (!defaults?.model) return results;

  const primary = defaults.model.primary;
  const fallbacks = defaults.model.fallbacks ?? [];

  if (!primary) return results;

  // Load auth profiles for token checking
  const authProfiles = loadAuthProfiles(agentDir);
  const profiles = authProfiles?.profiles ?? {};

  // --- Fallback chain analysis ---

  if (fallbacks.length === 0) {
    results.push({
      category: "Provider Failover",
      check: "Fallback chain",
      status: "fail",
      message: "No fallback models — if primary fails, agent is completely down",
      fix: "Add at least 2 fallback models from different providers",
    });
    return results;
  }

  // Check chain depth
  if (fallbacks.length === 1) {
    results.push({
      category: "Provider Failover",
      check: "Fallback depth",
      status: "warn",
      message: "Only 1 fallback — if both primary and fallback fail, agent is down",
      fix: "Add at least one more fallback from a different provider",
    });
  } else {
    results.push({
      category: "Provider Failover",
      check: "Fallback depth",
      status: "pass",
      message: `${fallbacks.length} fallback models configured`,
    });
  }

  // Check provider diversity
  const allModels = [primary, ...fallbacks];
  const providers = new Set(allModels.map(getProvider));

  if (providers.size === 1) {
    results.push({
      category: "Provider Failover",
      check: "Provider diversity",
      status: "fail",
      message: `All models use provider "${getProvider(primary)}" — single point of failure`,
      fix: "Add fallbacks from different providers (e.g. anthropic + openai-codex + openrouter)",
    });
  } else if (providers.size === 2) {
    results.push({
      category: "Provider Failover",
      check: "Provider diversity",
      status: "warn",
      message: `Only 2 providers in chain: ${[...providers].join(", ")}`,
      fix: "Consider adding a third provider for resilience",
    });
  } else {
    results.push({
      category: "Provider Failover",
      check: "Provider diversity",
      status: "pass",
      message: `${providers.size} providers: ${[...providers].join(", ")}`,
    });
  }

  // --- Auth coverage for each model in chain ---

  const now = Date.now();
  for (const model of allModels) {
    const provider = getProvider(model);
    const isSubscription = provider === "claude-cli" || provider === "openai-codex" || provider === "codex" || provider === "github-copilot";
    const isLocal = provider === "ollama" || provider === "lm-studio";

    if (isLocal) continue;

    // Find auth profiles for this provider
    const providerProfiles = Object.entries(profiles).filter(
      ([, p]) => p.provider === provider || p.provider === model.split("/")[0]
    );

    if (providerProfiles.length === 0 && !isSubscription) {
      // Check models.json for hardcoded keys
      const modelsJson = loadModelsJson(agentDir);
      const providers = (modelsJson as Record<string, unknown>)?.providers as Record<string, Record<string, unknown>> | undefined;
      const providerConfig = providers?.[provider];
      const hasHardcodedKey = providerConfig?.apiKey && typeof providerConfig.apiKey === "string";

      if (!hasHardcodedKey) {
        results.push({
          category: "Provider Failover",
          check: `Auth: ${model}`,
          status: "fail",
          message: `No auth found for ${model} — this fallback will fail if triggered`,
          fix: `Add auth: openclaw models auth login --provider ${provider}`,
        });
      }
      continue;
    }

    // Check for expired OAuth tokens
    // If at least one profile for this provider is valid, expired ones are just stale (info, not fail)
    const hasValidProfile = providerProfiles.some(
      ([, p]) => !p.expires || p.expires > now
    );

    for (const [name, profile] of providerProfiles) {
      if (profile.expires) {
        const remaining = profile.expires - now;
        if (remaining < 0) {
          const isPrimary = model === primary;
          if (hasValidProfile) {
            // Another profile works — this is just a stale entry
            results.push({
              category: "Provider Failover",
              check: `Auth: ${name}`,
              status: "info",
              message: `OAuth token expired ${Math.abs(Math.round(remaining / 3600000))}h ago (another ${provider} profile is valid)`,
            });
          } else {
            results.push({
              category: "Provider Failover",
              check: `Auth: ${name}`,
              status: isPrimary ? "fail" : "warn",
              message: `OAuth token expired ${Math.abs(Math.round(remaining / 3600000))}h ago${isPrimary ? " — PRIMARY MODEL" : ""}`,
              fix: `Re-authenticate: openclaw models auth login --provider ${provider}`,
            });
          }
        } else if (remaining < 3600000) {
          results.push({
            category: "Provider Failover",
            check: `Auth: ${name}`,
            status: "warn",
            message: `OAuth token expires in ${Math.round(remaining / 60000)}m — may fail during long sessions`,
          });
        }
      }
    }
  }

  // --- Cost escalation analysis ---

  const primaryCost = PROVIDER_COST[primary] ?? null;
  let costEscalationRisk = false;

  for (const fb of fallbacks) {
    const fbCost = PROVIDER_COST[fb] ?? null;
    if (primaryCost !== null && fbCost !== null && primaryCost === 0 && fbCost > 5) {
      costEscalationRisk = true;
      results.push({
        category: "Provider Failover",
        check: `Cost escalation: ${fb}`,
        status: "warn",
        message: `Primary is subscription ($0) but fallback ${fb} costs $${fbCost}/MTok — could spike costs unexpectedly`,
        fix: "Add a cheaper fallback before expensive ones in the chain",
      });
    } else if (primaryCost !== null && fbCost !== null && fbCost > primaryCost * 3 && fbCost > 5) {
      costEscalationRisk = true;
      results.push({
        category: "Provider Failover",
        check: `Cost escalation: ${fb}`,
        status: "warn",
        message: `Fallback ${fb} is ${(fbCost / Math.max(primaryCost, 0.01)).toFixed(0)}x more expensive than primary ($${fbCost} vs $${primaryCost}/MTok)`,
      });
    }
  }

  if (!costEscalationRisk && fallbacks.length > 0) {
    results.push({
      category: "Provider Failover",
      check: "Cost escalation risk",
      status: "pass",
      message: "No dangerous cost jumps in fallback chain",
    });
  }

  // --- Fallback order recommendation ---

  // Check if cheaper models come before expensive ones
  const chainWithCosts = allModels
    .map((m) => ({ model: m, cost: PROVIDER_COST[m] ?? -1 }))
    .filter((m) => m.cost >= 0);

  if (chainWithCosts.length >= 2) {
    let orderIssues = 0;
    for (let i = 1; i < chainWithCosts.length; i++) {
      const prev = chainWithCosts[i - 1];
      const curr = chainWithCosts[i];
      // Subscription (0) before paid is fine. Paid escalating is a concern.
      if (prev.cost > 0 && curr.cost > prev.cost * 2 && curr.cost > 5) {
        orderIssues++;
      }
    }
    if (orderIssues > 0) {
      results.push({
        category: "Provider Failover",
        check: "Fallback order",
        status: "info",
        message: "Consider ordering fallbacks cheap→expensive to minimize cost if primary fails",
      });
    }
  }

  // --- Latency analysis ---

  const primaryLatency = PROVIDER_LATENCY[getProvider(primary)] ?? "medium";
  const slowFallbacks = fallbacks.filter(
    (fb) => (PROVIDER_LATENCY[getProvider(fb)] ?? "medium") === "slow"
  );

  if (slowFallbacks.length > 0 && primaryLatency === "fast") {
    results.push({
      category: "Provider Failover",
      check: "Latency risk",
      status: "info",
      message: `${slowFallbacks.length} slow fallback(s): ${slowFallbacks.join(", ")} — may cause noticeable delay on failover`,
    });
  }

  return results;
}
