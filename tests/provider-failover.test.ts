import { describe, it, expect } from "vitest";
import { auditProviderFailover } from "../src/auditors/openclaw/provider-failover.js";
import type { OpenClawConfig } from "../src/types.js";

describe("auditProviderFailover", () => {
  it("fails when no fallbacks configured", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { model: { primary: "anthropic/claude-sonnet-4-6", fallbacks: [] } } },
    };
    const results = auditProviderFailover(config, "/tmp");
    expect(results.some((r) => r.status === "fail" && r.message.includes("No fallback"))).toBe(true);
  });

  it("warns with only 1 fallback", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-sonnet-4-6",
            fallbacks: ["openai/gpt-4o"],
          },
        },
      },
    };
    const results = auditProviderFailover(config, "/tmp");
    expect(results.some((r) => r.status === "warn" && r.check === "Fallback depth")).toBe(true);
  });

  it("passes with multiple fallbacks", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: "openai-codex/gpt-5.4",
            fallbacks: ["claude-cli/claude-sonnet-4-6", "openrouter/moonshotai/kimi-k2.5"],
          },
        },
      },
    };
    const results = auditProviderFailover(config, "/tmp");
    expect(results.some((r) => r.status === "pass" && r.check === "Fallback depth")).toBe(true);
  });

  it("fails when all models use same provider", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-sonnet-4-6",
            fallbacks: ["anthropic/claude-opus-4-6", "anthropic/claude-haiku-4-5"],
          },
        },
      },
    };
    const results = auditProviderFailover(config, "/tmp");
    expect(results.some((r) => r.status === "fail" && r.check === "Provider diversity")).toBe(true);
  });

  it("passes with multiple providers", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: "openai-codex/gpt-5.4",
            fallbacks: ["claude-cli/claude-sonnet-4-6", "openrouter/moonshotai/kimi-k2.5"],
          },
        },
      },
    };
    const results = auditProviderFailover(config, "/tmp");
    expect(results.some((r) => r.status === "pass" && r.check === "Provider diversity")).toBe(true);
  });

  it("warns about cost escalation from subscription to expensive", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: "openai-codex/gpt-5.4",
            fallbacks: ["anthropic/claude-opus-4-6"],
          },
        },
      },
    };
    const results = auditProviderFailover(config, "/tmp");
    expect(results.some((r) => r.check.includes("Cost escalation") && r.status === "warn")).toBe(true);
  });

  it("passes when no cost escalation", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: "openai-codex/gpt-5.4",
            fallbacks: ["claude-cli/claude-sonnet-4-6"],
          },
        },
      },
    };
    const results = auditProviderFailover(config, "/tmp");
    expect(results.some((r) => r.check === "Cost escalation risk" && r.status === "pass")).toBe(true);
  });

  it("downgrades plugin-provided providers to info instead of fail", () => {
    const config = {
      agents: {
        defaults: {
          model: {
            primary: "clawd/claude-fable-5",
            fallbacks: ["claude-cli/claude-opus-4-8"],
          },
        },
      },
      plugins: { allow: ["multi-clawd"], entries: { "multi-clawd": {} } },
    } as OpenClawConfig;
    const results = auditProviderFailover(config, "/tmp");
    const authResult = results.find((r) => r.check === "Auth: clawd/claude-fable-5");
    expect(authResult?.status).toBe("info");
    expect(authResult?.message).toContain("multi-clawd");
  });

  it("warns (not fails) for unknown providers with no plugin match", () => {
    const config = {
      agents: {
        defaults: {
          model: {
            primary: "someproxy/custom-model",
            fallbacks: ["claude-cli/claude-opus-4-8"],
          },
        },
      },
    } as OpenClawConfig;
    const results = auditProviderFailover(config, "/tmp");
    const authResult = results.find((r) => r.check === "Auth: someproxy/custom-model");
    expect(authResult?.status).toBe("warn");
  });

  it("treats inline models.providers apiKey in main config as auth", () => {
    const config = {
      agents: {
        defaults: {
          model: {
            primary: "mycorp/internal-model",
            fallbacks: ["claude-cli/claude-opus-4-8"],
          },
        },
      },
      models: { providers: { mycorp: { baseUrl: "https://llm.mycorp.example", apiKey: "sk-corp-xxx" } } },
    } as OpenClawConfig;
    const results = auditProviderFailover(config, "/tmp");
    expect(results.some((r) => r.check === "Auth: mycorp/internal-model")).toBe(false);
  });

  it("still fails known API providers with no auth anywhere", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-opus-4-8",
            fallbacks: ["openai/gpt-5.6"],
          },
        },
      },
    };
    const results = auditProviderFailover(config, "/tmp");
    expect(results.some((r) => r.check === "Auth: anthropic/claude-opus-4-8" && r.status === "fail")).toBe(true);
    expect(results.some((r) => r.check === "Auth: openai/gpt-5.6" && r.status === "fail")).toBe(true);
  });
});
