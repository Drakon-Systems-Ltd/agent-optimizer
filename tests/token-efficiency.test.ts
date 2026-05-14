import { describe, it, expect } from "vitest";
import { auditTokenEfficiency } from "../src/auditors/openclaw/token-efficiency.js";
import type { OpenClawConfig } from "../src/types.js";

describe("auditTokenEfficiency", () => {
  it("warns when context tokens exceed 500K", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { contextTokens: 1000000 } },
    };
    const results = auditTokenEfficiency(config);
    expect(results.some((r) => r.status === "warn" && r.check === "Context window size")).toBe(true);
  });

  it("passes when context tokens are reasonable", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { contextTokens: 200000 } },
    };
    const results = auditTokenEfficiency(config);
    expect(results.some((r) => r.status === "pass" && r.check === "Context window size")).toBe(true);
  });

  it("warns when heartbeat is under 2 hours", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { heartbeat: { every: "1h" } } },
    };
    const results = auditTokenEfficiency(config);
    expect(results.some((r) => r.status === "warn" && r.check === "Heartbeat frequency")).toBe(true);
  });

  it("passes when heartbeat is 6h or more", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { heartbeat: { every: "6h" } } },
    };
    const results = auditTokenEfficiency(config);
    expect(results.some((r) => r.status === "pass" && r.check === "Heartbeat frequency")).toBe(true);
  });

  it("warns when subagent concurrency exceeds 6", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { subagents: { maxConcurrent: 8 } } },
    };
    const results = auditTokenEfficiency(config);
    expect(results.some((r) => r.status === "warn" && r.check === "Subagent concurrency")).toBe(true);
  });

  it("passes when subagent concurrency is reasonable", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { subagents: { maxConcurrent: 4 } } },
    };
    const results = auditTokenEfficiency(config);
    expect(results.some((r) => r.status === "pass" && r.check === "Subagent concurrency")).toBe(true);
  });

  it("warns when no compaction configured", () => {
    const config: OpenClawConfig = {
      agents: { defaults: {} },
    };
    const results = auditTokenEfficiency(config);
    expect(results.some((r) => r.status === "warn" && r.check === "Compaction configured")).toBe(true);
  });

  it("passes when compaction is configured", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { compaction: { mode: "safeguard" } } },
    };
    const results = auditTokenEfficiency(config);
    expect(results.some((r) => r.status === "pass" && r.check === "Compaction configured")).toBe(true);
  });

  it("warns when no context pruning configured", () => {
    const config: OpenClawConfig = {
      agents: { defaults: {} },
    };
    const results = auditTokenEfficiency(config);
    expect(results.some((r) => r.status === "warn" && r.check === "Context pruning")).toBe(true);
  });

  it("passes when context pruning is configured", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: { contextPruning: { mode: "cache-ttl", ttl: "2h" } },
      },
    };
    const results = auditTokenEfficiency(config);
    expect(results.some((r) => r.status === "pass" && r.check === "Context pruning")).toBe(true);
  });
});
