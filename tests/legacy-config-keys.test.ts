import { describe, it, expect } from "vitest";
import { auditLegacyConfigKeys } from "../src/auditors/openclaw/legacy-config-keys.js";
import type { OpenClawConfig } from "../src/types.js";

describe("auditLegacyConfigKeys", () => {
  it("empty for a clean modern config", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { model: { primary: "anthropic/claude-opus-4-8" } } },
      gateway: { port: 18789 },
    };
    expect(auditLegacyConfigKeys(config)).toHaveLength(0);
  });

  it("flags legacy top-level memorySearch and heartbeat", () => {
    const config = {
      memorySearch: { enabled: true },
      heartbeat: { every: "1h" },
    } as OpenClawConfig;
    const results = auditLegacyConfigKeys(config);
    expect(results.some((r) => r.check === "Top-level memorySearch" && r.status === "warn")).toBe(true);
    expect(results.some((r) => r.check === "Top-level heartbeat" && r.status === "warn")).toBe(true);
  });

  it("flags removed agents.defaults keys with migration notes", () => {
    const config = {
      agents: { defaults: { llm: { primary: "x" }, agentRuntime: "pi" } },
    } as unknown as OpenClawConfig;
    const results = auditLegacyConfigKeys(config);
    expect(results.some((r) => r.check === "agents.defaults.llm")).toBe(true);
    expect(results.some((r) => r.check === "agents.defaults.agentRuntime")).toBe(true);
  });

  it("flags session.maintenance.pruneDays rename", () => {
    const config = {
      session: { maintenance: { pruneDays: 30 } },
    } as OpenClawConfig;
    const results = auditLegacyConfigKeys(config);
    const finding = results.find((r) => r.check === "session.maintenance.pruneDays");
    expect(finding?.status).toBe("warn");
    expect(finding?.message).toContain("pruneAfter");
  });

  it("flags legacy web-search provider blocks", () => {
    const config = {
      tools: { web: { search: { brave: { apiKey: "x" }, tavily: { apiKey: "y" }, enabled: true } } },
    } as unknown as OpenClawConfig;
    const results = auditLegacyConfigKeys(config);
    const finding = results.find((r) => r.check === "Web search provider blocks");
    expect(finding?.status).toBe("warn");
    expect(finding?.message).toContain("brave");
    expect(finding?.message).toContain("tavily");
  });

  it("flags gateway.webchat and session.threadBindings", () => {
    const config = {
      gateway: { webchat: {} },
      session: { threadBindings: {} },
    } as OpenClawConfig;
    const results = auditLegacyConfigKeys(config);
    expect(results.some((r) => r.check === "gateway.webchat")).toBe(true);
    expect(results.some((r) => r.check === "session.threadBindings")).toBe(true);
  });
});
