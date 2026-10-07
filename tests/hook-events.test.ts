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

  it.each([
    "command",
    "session:patch",
    "gateway:shutdown",
    "gateway:pre-restart",
  ])("does not flag v2026.6 event %s as unknown", (event) => {
    const config: OpenClawConfig = {
      hooks: { internal: { entries: { h: { event } } } },
    };
    expect(auditHookEvents(config).every(r => r.status !== "fail")).toBe(true);
  });

  it("does not flag the v2026.9 session:auto-reset event as unknown", () => {
    const config: OpenClawConfig = {
      hooks: { internal: { entries: { h: { event: "session:auto-reset" } } } },
    };
    expect(auditHookEvents(config).every(r => r.status !== "fail")).toBe(true);
  });

  it("recognises every key in the v2026.9.8 KNOWN_INTERNAL_HOOK_EVENT_KEYS list", () => {
    const events = [
      "agent:bootstrap", "command:new", "command:reset", "command:stop",
      "gateway:pre-restart", "gateway:shutdown", "gateway:startup",
      "message:preprocessed", "message:received", "message:sent", "message:transcribed",
      "session:auto-reset", "session:compact:after", "session:compact:before", "session:patch",
    ];
    for (const event of events) {
      const config: OpenClawConfig = {
        hooks: { internal: { entries: { h: { event } } } },
      };
      expect(auditHookEvents(config).every(r => r.status !== "fail"), event).toBe(true);
    }
  });

  it("still flags gateway:agent (a commandSource value, not an event key) and the docs' command:nwe example", () => {
    for (const event of ["gateway:agent", "command:nwe"]) {
      const config: OpenClawConfig = {
        hooks: { internal: { entries: { h: { event } } } },
      };
      const results = auditHookEvents(config);
      expect(results.some(r => r.status === "fail" && r.message.includes("Unknown hook event")), event).toBe(true);
    }
  });

  it("still flags a genuine typo of a v2026.6 event", () => {
    const config: OpenClawConfig = {
      hooks: { internal: { entries: { h: { event: "gateway:shutdwn" } } } },
    };
    const results = auditHookEvents(config);
    expect(results.some(r => r.status === "fail" && r.message.includes("Unknown hook event"))).toBe(true);
  });

  it("ignores entries with no event field", () => {
    const config: OpenClawConfig = {
      hooks: { internal: { entries: { h: { enabled: true } } } },
    };
    expect(auditHookEvents(config)).toHaveLength(0);
  });
});
