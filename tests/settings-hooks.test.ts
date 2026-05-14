import { describe, it, expect } from "vitest";
import { auditSettingsHooks } from "../src/auditors/claude-code/settings-hooks.js";

describe("auditSettingsHooks", () => {
  it("returns empty when settings has no hooks", () => {
    expect(auditSettingsHooks({})).toHaveLength(0);
  });

  it("fails on unknown event name", () => {
    const results = auditSettingsHooks({
      hooks: {
        UnknownEvent: [{ hooks: [{ type: "command", command: "echo hi" }] }],
      },
    });
    expect(results.some(r => r.status === "fail" && r.check.toLowerCase().includes("unknown event"))).toBe(true);
  });

  it("accepts all known event names without unknown-event fail", () => {
    const hooks: Record<string, Array<{ hooks: Array<{ type?: string; command?: string }> }>> = {};
    for (const ev of [
      "PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart", "SessionEnd",
      "Stop", "Notification", "PreCompact", "SubagentStop",
    ]) {
      hooks[ev] = [{ hooks: [{ type: "command", command: "echo hi" }] }];
    }
    const results = auditSettingsHooks({ hooks });
    expect(results.some(r => r.check.toLowerCase().includes("unknown event"))).toBe(false);
  });

  it("warns when an event has more than 5 hooks attached", () => {
    const results = auditSettingsHooks({
      hooks: {
        UserPromptSubmit: Array.from({ length: 6 }, () => ({
          hooks: [{ type: "command", command: "echo hi" }],
        })),
      },
    });
    expect(results.some(r => r.status === "warn" && r.check.toLowerCase().includes("hook count"))).toBe(true);
  });

  it("info when a hook entry has no timeout field", () => {
    const results = auditSettingsHooks({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo hi" }] }],
      },
    });
    expect(results.some(r => r.status === "info" && r.check.toLowerCase().includes("timeout"))).toBe(true);
  });

  it("warns when a hook timeout exceeds 30 seconds", () => {
    const results = auditSettingsHooks({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo hi", timeout: 60 }] }],
      },
    });
    expect(results.some(r => r.status === "warn" && r.check.toLowerCase().includes("timeout"))).toBe(true);
  });

  it("fails when matcher is an invalid regex", () => {
    const results = auditSettingsHooks({
      hooks: {
        PreToolUse: [
          { matcher: "[unclosed", hooks: [{ type: "command", command: "echo hi", timeout: 5 }] },
        ],
      },
    });
    expect(results.some(r => r.status === "fail" && r.check.toLowerCase().includes("matcher"))).toBe(true);
  });

  it("info when an event entry has empty hooks array", () => {
    const results = auditSettingsHooks({
      hooks: {
        Stop: [{ hooks: [] }],
      },
    });
    expect(results.some(r => r.status === "info" && r.check.toLowerCase().includes("empty"))).toBe(true);
  });

  it("info when an event entry has missing .hooks field", () => {
    const results = auditSettingsHooks({
      hooks: {
        Stop: [{ matcher: ".*" }],
      },
    });
    expect(results.some(r => r.status === "info" && r.check.toLowerCase().includes("empty"))).toBe(true);
  });

  it("clean hooks block produces no fail/warn", () => {
    const results = auditSettingsHooks({
      hooks: {
        UserPromptSubmit: [
          { matcher: ".*", hooks: [{ type: "command", command: "echo hi", timeout: 5 }] },
        ],
      },
    });
    expect(results.every(r => r.status !== "fail" && r.status !== "warn")).toBe(true);
  });
});
