import { describe, it, expect } from "vitest";
import { auditToolPermissions } from "../src/auditors/tool-permissions.js";
import type { OpenClawConfig } from "../src/types.js";

describe("auditToolPermissions", () => {
  it("warns when agent has no tools block", () => {
    const config: OpenClawConfig = {
      agents: {
        list: [{ id: "main", name: "Test", workspace: "/tmp", agentDir: "/tmp" }],
      },
    };
    const results = auditToolPermissions(config);
    expect(results.some((r) => r.status === "warn" && r.message.includes("No tools block"))).toBe(true);
  });

  it("fails when same group is in both alsoAllow and deny", () => {
    const config: OpenClawConfig = {
      agents: {
        list: [
          {
            id: "main",
            name: "Test",
            workspace: "/tmp",
            agentDir: "/tmp",
            tools: {
              alsoAllow: ["group:runtime", "group:web"],
              deny: ["group:web"],
            },
          },
        ],
      },
    };
    const results = auditToolPermissions(config);
    expect(results.some((r) => r.status === "fail" && r.check.includes("conflicts"))).toBe(true);
  });

  it("warns when elevated allowed but no allowFrom channels", () => {
    const config: OpenClawConfig = {
      agents: {
        list: [
          {
            id: "main",
            name: "Test",
            workspace: "/tmp",
            agentDir: "/tmp",
            tools: {
              alsoAllow: ["group:elevated"],
            },
          },
        ],
      },
    };
    const results = auditToolPermissions(config);
    expect(results.some((r) => r.status === "warn" && r.check.includes("elevated config"))).toBe(true);
  });

  it("reports current permissions as info", () => {
    const config: OpenClawConfig = {
      agents: {
        list: [
          {
            id: "main",
            name: "Jarvis",
            workspace: "/tmp",
            agentDir: "/tmp",
            tools: {
              alsoAllow: ["group:runtime", "group:elevated", "group:web", "group:fs"],
              elevated: { allowFrom: { telegram: ["*"], cli: ["*"] } },
            },
          },
        ],
      },
    };
    const results = auditToolPermissions(config);
    expect(results.some((r) => r.status === "info" && r.check.includes("permissions"))).toBe(true);
  });
});
