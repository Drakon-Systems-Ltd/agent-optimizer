import { describe, it, expect } from "vitest";
import { auditModelConfig } from "../src/auditors/model-config.js";
import type { OpenClawConfig } from "../src/types.js";

describe("auditModelConfig", () => {
  it("fails when no primary model is set", () => {
    const config: OpenClawConfig = { agents: { defaults: {} } };
    const results = auditModelConfig(config);
    expect(results.some((r) => r.status === "fail" && r.check === "Primary model set")).toBe(true);
  });

  it("passes when primary model is set", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-sonnet-4-6", fallbacks: [] },
        },
      },
    };
    const results = auditModelConfig(config);
    expect(results.some((r) => r.status === "pass" && r.check === "Primary model set")).toBe(true);
  });

  it("warns when no fallback models configured", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-sonnet-4-6", fallbacks: [] },
        },
      },
    };
    const results = auditModelConfig(config);
    expect(results.some((r) => r.status === "warn" && r.check === "Fallback models")).toBe(true);
  });

  it("warns when primary is duplicated in fallbacks", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-sonnet-4-6",
            fallbacks: ["anthropic/claude-sonnet-4-6", "openai/gpt-4o"],
          },
        },
      },
    };
    const results = auditModelConfig(config);
    expect(results.some((r) => r.status === "warn" && r.check === "Fallback duplication")).toBe(true);
  });

  it("warns when all fallbacks use same provider", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-sonnet-4-6",
            fallbacks: ["anthropic/claude-opus-4-6"],
          },
        },
      },
    };
    const results = auditModelConfig(config);
    expect(results.some((r) => r.status === "warn" && r.check === "Cross-provider fallback")).toBe(true);
  });

  it("passes when fallbacks include multiple providers", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-sonnet-4-6",
            fallbacks: ["openai-codex/gpt-5.4", "openrouter/moonshotai/kimi-k2.5"],
          },
        },
      },
    };
    const results = auditModelConfig(config);
    expect(results.some((r) => r.status === "pass" && r.check === "Cross-provider fallback")).toBe(true);
  });

  it("fails on invalid thinkingDefault", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-sonnet-4-6" },
          thinkingDefault: "auto",
        },
      },
    };
    const results = auditModelConfig(config);
    expect(results.some((r) => r.status === "fail" && r.check === "thinkingDefault value")).toBe(true);
  });

  it("passes on valid thinkingDefault", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-sonnet-4-6" },
          thinkingDefault: "adaptive",
        },
      },
    };
    const results = auditModelConfig(config);
    expect(results.some((r) => r.status === "pass" && r.check === "thinkingDefault value")).toBe(true);
  });

  it("warns on legacy model alias in primary", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "openai-codex/gpt-5.4-codex" },
        },
      },
    };
    const results = auditModelConfig(config);
    expect(results.some((r) => r.status === "warn" && r.check.includes("alias"))).toBe(true);
  });

  it("warns on legacy model alias in fallbacks", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-sonnet-4-6",
            fallbacks: ["openai-codex/gpt-5.4-codex"],
          },
        },
      },
    };
    const results = auditModelConfig(config);
    expect(results.some((r) => r.status === "warn" && r.message.includes("legacy alias"))).toBe(true);
  });

  it("warns when xhigh thinking used with unsupported model", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "openai/gpt-4o-mini" },
          thinkingDefault: "xhigh",
        },
      },
    };
    const results = auditModelConfig(config);
    expect(results.some((r) => r.status === "warn" && r.check === "thinkingDefault compatibility")).toBe(true);
  });

  it("reports minimal-to-low mapping for OpenAI models", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "openai-codex/gpt-5.4" },
          thinkingDefault: "minimal",
        },
      },
    };
    const results = auditModelConfig(config);
    expect(results.some((r) => r.status === "info" && r.check === "thinkingDefault mapping")).toBe(true);
  });
});
