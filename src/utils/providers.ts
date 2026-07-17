import type { OpenClawConfig } from "../types.js";

// Subscription-backed providers authenticate via their own CLI/OAuth flows,
// not auth profiles the audit can inspect.
export const SUBSCRIPTION_PROVIDERS = new Set([
  "claude-cli",
  "openai-codex",
  "codex",
  "github-copilot",
]);

export const LOCAL_PROVIDERS = new Set(["ollama", "lm-studio", "lmstudio", "vllm", "sglang"]);

// API providers where a missing auth profile is a genuine failure (well-known
// hosted APIs that always need credentials).
export const KNOWN_API_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "openrouter",
  "google",
  "google-ai",
  "deepseek",
  "xai",
  "mistral",
  "groq",
  "together",
  "fireworks",
  "moonshot",
  "moonshotai",
]);

type ProviderRecord = Record<string, Record<string, unknown> | undefined>;

function configProviders(config: OpenClawConfig): ProviderRecord | null {
  const models = (config as { models?: { providers?: unknown } }).models;
  if (models?.providers && typeof models.providers === "object") {
    return models.providers as ProviderRecord;
  }
  return null;
}

/** Provider is declared inline at models.providers.<p> — the current home for
 * custom providers (agent-dir models.json is legacy). */
export function configDeclaresProvider(config: OpenClawConfig, provider: string): boolean {
  return !!configProviders(config)?.[provider];
}

/** Declared provider carries its own credential (inline apiKey / SecretRef). */
export function configProviderHasKey(config: OpenClawConfig, provider: string): boolean {
  const entry = configProviders(config)?.[provider];
  return !!entry && "apiKey" in entry && entry.apiKey != null && entry.apiKey !== "";
}

/**
 * Best-effort match for a plugin that may register this provider at runtime
 * (provider plugins add model providers the config never declares). Substring
 * match is intentional: e.g. plugin "multi-clawd" provides provider "clawd".
 */
export function findProvidingPlugin(config: OpenClawConfig, provider: string): string | null {
  const plugins = (config as { plugins?: { allow?: unknown; entries?: unknown } }).plugins;
  if (!plugins || typeof plugins !== "object") return null;
  const names = new Set<string>();
  if (Array.isArray(plugins.allow)) {
    for (const n of plugins.allow) if (typeof n === "string") names.add(n);
  }
  if (plugins.entries && typeof plugins.entries === "object") {
    for (const n of Object.keys(plugins.entries)) names.add(n);
  }
  for (const name of names) {
    if (name === provider || name.includes(provider) || provider.includes(name)) return name;
  }
  return null;
}
