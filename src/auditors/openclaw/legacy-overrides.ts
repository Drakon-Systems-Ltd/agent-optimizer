import type { AuditResult, OpenClawConfig } from "../../types.js";
import { loadModelsJson } from "../../utils/config.js";

export function auditLegacyOverrides(
  config: OpenClawConfig,
  agentDir: string
): AuditResult[] {
  const results: AuditResult[] = [];
  const modelsJson = loadModelsJson(agentDir);

  if (!modelsJson) {
    results.push({
      category: "Legacy Overrides",
      check: "models.json exists",
      status: "info",
      message: "No models.json found — using defaults",
    });
    return results;
  }

  const providers = (modelsJson as Record<string, unknown>).providers as
    | Record<string, Record<string, unknown>>
    | undefined;

  if (!providers) return results;

  // Check for legacy Codex transport override
  const codex = providers["openai-codex"];
  if (codex) {
    const hasLegacyApi =
      codex.api === "openai-responses" || codex.api === "openai-completions";
    const hasLegacyBase = codex.baseUrl === "https://api.openai.com/v1";

    if (hasLegacyApi || hasLegacyBase) {
      results.push({
        category: "Legacy Overrides",
        check: "Codex transport override",
        status: "fail",
        message:
          'Legacy openai-codex transport override detected (api/baseUrl) — shadows built-in Codex OAuth path',
        fix: 'Remove "api" and "baseUrl" from openai-codex in models.json',
        autoFixable: true,
      });
    } else {
      results.push({
        category: "Legacy Overrides",
        check: "Codex transport override",
        status: "pass",
        message: "No legacy Codex transport override",
      });
    }
  }

  // Check for hardcoded API keys in models.json
  for (const [providerName, provider] of Object.entries(providers)) {
    if (
      provider.apiKey &&
      typeof provider.apiKey === "string" &&
      !provider.apiKey.startsWith("__OP:") &&
      provider.apiKey !== "ANTHROPIC_API_KEY" &&
      provider.apiKey !== "OPENROUTER_API_KEY" &&
      provider.apiKey !== "DEEPSEEK_API_KEY" &&
      provider.apiKey !== "XAI_API_KEY"
    ) {
      const key = provider.apiKey as string;
      if (key.startsWith("sk-") || key.startsWith("xai-") || key.startsWith("AIza")) {
        results.push({
          category: "Legacy Overrides",
          check: `Hardcoded key: ${providerName}`,
          status: "warn",
          message: `API key hardcoded in models.json for "${providerName}" — use auth profiles instead`,
          fix: "Move key to auth-profiles.json or use environment variables",
        });
      }
    }
  }

  // Check for allowPrivateNetwork on non-local providers (v2026.4.12+)
  for (const [providerName, provider] of Object.entries(providers)) {
    const request = provider.request as Record<string, unknown> | undefined;
    if (request?.allowPrivateNetwork === true) {
      const isLocalProvider = providerName === "lm-studio" || providerName === "ollama";
      results.push({
        category: "Legacy Overrides",
        check: `Private network: ${providerName}`,
        status: isLocalProvider ? "pass" : "info",
        message: isLocalProvider
          ? `${providerName} has allowPrivateNetwork — correct for local models`
          : `${providerName} has allowPrivateNetwork enabled — ensure this is intentional for a trusted self-hosted endpoint`,
      });
    }
  }

  // Check for stale model entries referencing old APIs
  for (const [providerName, provider] of Object.entries(providers)) {
    const models = provider.models as Array<Record<string, unknown>> | undefined;
    if (models) {
      for (const model of models) {
        if (
          model.api &&
          model.api !== "anthropic-messages" &&
          model.api !== "openai-codex-responses"
        ) {
          results.push({
            category: "Legacy Overrides",
            check: `Model API override: ${providerName}/${model.id}`,
            status: "info",
            message: `Model has explicit api: "${model.api}" — may shadow provider defaults`,
          });
        }
      }
    }
  }

  return results;
}
