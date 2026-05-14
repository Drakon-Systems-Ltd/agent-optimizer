import { describe, it, expect } from "vitest";
import { auditCostEstimate } from "../src/auditors/openclaw/cost-estimator.js";
import type { OpenClawConfig } from "../src/types.js";

describe("auditCostEstimate", () => {
  it("shows subscription for claude-cli models", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { model: { primary: "claude-cli/claude-sonnet-4-6" } } },
    };
    const results = auditCostEstimate(config);
    expect(results.some((r) => r.status === "pass" && r.message.includes("subscription"))).toBe(true);
  });

  it("shows subscription for openai-codex models", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { model: { primary: "openai-codex/gpt-5.4" } } },
    };
    const results = auditCostEstimate(config);
    expect(results.some((r) => r.status === "pass" && r.message.includes("subscription"))).toBe(true);
  });

  it("estimates cost for pay-per-token models", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-sonnet-4-6" },
          contextTokens: 200000,
          heartbeat: { every: "6h" },
        },
      },
    };
    const results = auditCostEstimate(config);
    expect(results.some((r) => r.check === "Estimated monthly cost")).toBe(true);
  });

  it("warns about expensive fallbacks", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-sonnet-4-6",
            fallbacks: ["anthropic/claude-opus-4-6"],
          },
          contextTokens: 200000,
        },
      },
    };
    const results = auditCostEstimate(config);
    expect(results.some((r) => r.check.includes("Fallback cost") && r.status === "warn")).toBe(true);
  });

  it("suggests subscription when available as fallback", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: "anthropic/claude-sonnet-4-6",
            fallbacks: ["claude-cli/claude-sonnet-4-6"],
          },
          contextTokens: 200000,
          heartbeat: { every: "1h" },
        },
      },
    };
    const results = auditCostEstimate(config);
    expect(results.some((r) => r.check === "Subscription model available")).toBe(true);
  });

  it("calculates savings for balanced profile", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-opus-4-6" },
          contextTokens: 1000000,
          heartbeat: { every: "1h" },
        },
      },
    };
    const results = auditCostEstimate(config);
    expect(results.some((r) => r.check.includes("Potential savings"))).toBe(true);
  });
});
