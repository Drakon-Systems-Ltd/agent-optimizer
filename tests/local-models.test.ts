import { describe, it, expect } from "vitest";
import { auditLocalModels } from "../src/auditors/local-models.js";
import type { OpenClawConfig } from "../src/types.js";

describe("auditLocalModels", () => {
  it("returns empty when no local models in use", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-sonnet-4-6", fallbacks: [] },
        },
      },
    };
    const results = auditLocalModels(config);
    expect(results).toHaveLength(0);
  });

  it("warns when localModelLean not enabled for local primary", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "lm-studio/llama-3.2-8b" },
        },
      },
    };
    const results = auditLocalModels(config);
    expect(results.some((r) => r.check === "Lean mode" && r.status === "warn")).toBe(true);
  });

  it("passes when localModelLean is enabled", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "lm-studio/llama-3.2-8b" },
          experimental: { localModelLean: true },
        } as any,
      },
    };
    const results = auditLocalModels(config);
    expect(results.some((r) => r.check === "Lean mode" && r.status === "pass")).toBe(true);
  });

  it("warns when context window is too large for local model", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "ollama/llama3" },
          contextTokens: 200000,
        },
      },
    };
    const results = auditLocalModels(config);
    expect(results.some((r) => r.check === "Context window size" && r.status === "warn")).toBe(true);
  });

  it("passes when context window is reasonable for local model", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "ollama/llama3" },
          contextTokens: 8192,
        },
      },
    };
    const results = auditLocalModels(config);
    expect(results.some((r) => r.check === "Context window size" && r.status === "pass")).toBe(true);
  });

  it("fails when compaction reserve exceeds context window", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "lm-studio/phi-3" },
          contextTokens: 4096,
          compaction: { mode: "safeguard", reserveTokensFloor: 8000 },
        },
      },
    };
    const results = auditLocalModels(config);
    expect(results.some((r) => r.check === "Compaction reserve overflow" && r.status === "fail")).toBe(true);
  });

  it("warns when compaction reserve is over 50% of context", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "lm-studio/phi-3" },
          contextTokens: 8192,
          compaction: { mode: "safeguard", reserveTokensFloor: 5000 },
        },
      },
    };
    const results = auditLocalModels(config);
    expect(results.some((r) => r.check === "Compaction reserve ratio" && r.status === "warn")).toBe(true);
  });

  it("warns on high subagent concurrency with local model", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "ollama/mistral" },
          subagents: { maxConcurrent: 4 },
        },
      },
    };
    const results = auditLocalModels(config);
    expect(results.some((r) => r.check === "Subagent concurrency" && r.status === "warn")).toBe(true);
  });

  it("warns on frequent heartbeat with local model", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "lm-studio/gemma-2b" },
          heartbeat: { every: "30m" },
        },
      },
    };
    const results = auditLocalModels(config);
    expect(results.some((r) => r.check === "Heartbeat frequency" && r.status === "warn")).toBe(true);
  });

  it("reports thinking mode info for local models", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "ollama/llama3" },
          thinkingDefault: "adaptive",
        },
      },
    };
    const results = auditLocalModels(config);
    expect(results.some((r) => r.check === "Thinking mode" && r.status === "info")).toBe(true);
  });

  it("reports all-local fallback risk", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: "ollama/llama3",
            fallbacks: ["lm-studio/mistral-7b"],
          },
        },
      },
    };
    const results = auditLocalModels(config);
    expect(results.some((r) => r.check === "Fallback resilience" && r.status === "info")).toBe(true);
  });

  it("reports good resilience with mixed local/cloud", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: "ollama/llama3",
            fallbacks: ["anthropic/claude-sonnet-4-6"],
          },
        },
      },
    };
    const results = auditLocalModels(config);
    expect(results.some((r) => r.check === "Cloud fallback" && r.status === "pass")).toBe(true);
  });
});
