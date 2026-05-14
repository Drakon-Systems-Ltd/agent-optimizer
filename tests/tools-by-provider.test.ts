import { describe, it, expect } from "vitest";
import { auditToolsByProvider } from "../src/auditors/openclaw/tools-by-provider.js";
import type { OpenClawConfig } from "../src/types.js";

describe("auditToolsByProvider", () => {
  it("returns empty when no byProvider config", () => {
    expect(auditToolsByProvider({})).toHaveLength(0);
    expect(auditToolsByProvider({ tools: {} })).toHaveLength(0);
  });

  it("passes for valid profile names", () => {
    for (const profile of ["minimal", "coding", "default"]) {
      const config: OpenClawConfig = { tools: { byProvider: { "x/y": { profile } } } };
      const results = auditToolsByProvider(config);
      expect(results.every(r => r.status !== "fail")).toBe(true);
      expect(results.some(r => r.check.includes("Unknown profile"))).toBe(false);
    }
  });

  it("flags unknown profile name", () => {
    const config: OpenClawConfig = {
      tools: { byProvider: { "openai/gpt-5.2": { profile: "agressive" } } },
    };
    const results = auditToolsByProvider(config);
    expect(results.some(r => r.status === "fail" && r.check.includes("Unknown profile"))).toBe(true);
  });

  it("flags allow/deny conflict", () => {
    const config: OpenClawConfig = {
      tools: {
        byProvider: {
          "openai/gpt-5.2": { allow: ["exec", "read"], deny: ["exec", "write"] },
        },
      },
    };
    const results = auditToolsByProvider(config);
    expect(results.some(r => r.status === "fail" && r.check.includes("conflict"))).toBe(true);
  });

  it("does not flag conflict when allow and deny are disjoint", () => {
    const config: OpenClawConfig = {
      tools: {
        byProvider: {
          "openai/gpt-5.2": { allow: ["read"], deny: ["exec"] },
        },
      },
    };
    const results = auditToolsByProvider(config);
    expect(results.some(r => r.check.includes("conflict"))).toBe(false);
  });

  it("flags empty provider key", () => {
    const config: OpenClawConfig = {
      tools: { byProvider: { "": { profile: "minimal" } } },
    };
    const results = auditToolsByProvider(config);
    expect(results.some(r => r.status === "warn" && r.check.includes("Empty provider"))).toBe(true);
  });

  it("handles multiple providers and aggregates issues", () => {
    const config: OpenClawConfig = {
      tools: {
        byProvider: {
          "good/one": { profile: "minimal" },
          "bad/profile": { profile: "weird" },
          "bad/conflict": { allow: ["x"], deny: ["x"] },
        },
      },
    };
    const results = auditToolsByProvider(config);
    expect(results.filter(r => r.status === "fail").length).toBeGreaterThanOrEqual(2);
  });
});
