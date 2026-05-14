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
});
