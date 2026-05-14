import { describe, it, expect } from "vitest";
import { auditHooksDeprecations } from "../src/auditors/openclaw/hooks-deprecations.js";
import type { OpenClawConfig } from "../src/types.js";

describe("auditHooksDeprecations", () => {
  it("returns empty when no hooks configured", () => {
    expect(auditHooksDeprecations({})).toHaveLength(0);
  });

  it("warns on legacy handlers[] array format", () => {
    const config: OpenClawConfig = {
      hooks: { internal: { handlers: [{ event: "command:new", module: "./h.js" }] } },
    };
    const results = auditHooksDeprecations(config);
    expect(results.some(r => r.status === "warn" && r.check.toLowerCase().includes("legacy"))).toBe(true);
  });

  it("warns on before_agent_start hook usage", () => {
    const config: OpenClawConfig = {
      hooks: { internal: { entries: { starter: { event: "before_agent_start" } } } },
    };
    const results = auditHooksDeprecations(config);
    expect(results.some(r => r.status === "warn" && r.message.includes("before_agent_start"))).toBe(true);
  });

  it("passes when using current entries format with valid events", () => {
    const config: OpenClawConfig = {
      hooks: { internal: { entries: { good: { event: "command:new" } } } },
    };
    const results = auditHooksDeprecations(config);
    expect(results.every(r => r.status !== "fail")).toBe(true);
  });
});
