import { describe, it, expect } from "vitest";
import { auditCacheEfficiency } from "../src/auditors/cache-efficiency.js";
import type { OpenClawConfig } from "../src/types.js";

describe("auditCacheEfficiency", () => {
  it("warns when no context pruning configured", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { model: { primary: "anthropic/claude-sonnet-4-6" } } },
    };
    const results = auditCacheEfficiency(config);
    expect(results.some((r) => r.status === "warn" && r.check === "Context pruning mode")).toBe(true);
  });

  it("passes with cache-ttl pruning", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-sonnet-4-6" },
          contextPruning: { mode: "cache-ttl", ttl: "2h" },
        },
      },
    };
    const results = auditCacheEfficiency(config);
    expect(results.some((r) => r.status === "pass" && r.check === "Context pruning mode")).toBe(true);
  });

  it("warns when heartbeat is in the 5-10min dead zone for Anthropic", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-sonnet-4-6" },
          heartbeat: { every: "7m" },
        },
      },
    };
    const results = auditCacheEfficiency(config);
    expect(results.some((r) => r.status === "warn" && r.check === "Heartbeat vs cache TTL")).toBe(true);
  });

  it("passes when heartbeat keeps cache warm (under 5min)", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-sonnet-4-6" },
          heartbeat: { every: "4m" },
        },
      },
    };
    const results = auditCacheEfficiency(config);
    expect(results.some((r) => r.status === "pass" && r.check === "Heartbeat vs cache TTL")).toBe(true);
  });

  it("warns about frequent heartbeats without lightContext", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-sonnet-4-6" },
          heartbeat: { every: "30m" },
        },
      },
    };
    const results = auditCacheEfficiency(config);
    expect(results.some((r) => r.status === "warn" && r.check === "Heartbeat light context")).toBe(true);
  });

  it("passes with lightContext enabled", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-sonnet-4-6" },
          heartbeat: { every: "30m", lightContext: true },
        },
      },
    };
    const results = auditCacheEfficiency(config);
    expect(results.some((r) => r.status === "pass" && r.check === "Heartbeat light context")).toBe(true);
  });

  it("warns about expensive compaction model", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          compaction: { mode: "safeguard", model: "anthropic/claude-opus-4-6" },
        },
      },
    };
    const results = auditCacheEfficiency(config);
    expect(results.some((r) => r.status === "warn" && r.check === "Compaction model cost")).toBe(true);
  });
});
