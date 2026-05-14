import { describe, it, expect } from "vitest";
import { auditHookEvents } from "../src/auditors/openclaw/hook-events.js";
import type { OpenClawConfig } from "../src/types.js";

describe("auditHookEvents", () => {
  it("returns empty when no hooks configured", () => {
    expect(auditHookEvents({})).toHaveLength(0);
  });

  it("passes for known events", () => {
    const config: OpenClawConfig = {
      hooks: { internal: { entries: { h: { event: "message:received" } } } },
    };
    expect(auditHookEvents(config).every(r => r.status !== "fail")).toBe(true);
  });

  it("flags unknown event names", () => {
    const config: OpenClawConfig = {
      hooks: { internal: { entries: { h: { event: "message:recieved" } } } },
    };
    const results = auditHookEvents(config);
    expect(results.some(r => r.status === "fail" && r.message.includes("Unknown hook event"))).toBe(true);
  });

  it("recognises all v2026.3.14 events", () => {
    const events = [
      "command:new", "command:reset", "command:stop",
      "session:compact:before", "session:compact:after",
      "agent:bootstrap", "gateway:startup",
      "message:received", "message:transcribed", "message:preprocessed", "message:sent",
    ];
    for (const event of events) {
      const config: OpenClawConfig = {
        hooks: { internal: { entries: { h: { event } } } },
      };
      expect(auditHookEvents(config).every(r => r.status !== "fail")).toBe(true);
    }
  });

  it("ignores entries with no event field", () => {
    const config: OpenClawConfig = {
      hooks: { internal: { entries: { h: { enabled: true } } } },
    };
    expect(auditHookEvents(config)).toHaveLength(0);
  });
});
