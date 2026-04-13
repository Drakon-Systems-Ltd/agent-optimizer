import { describe, it, expect } from "vitest";
import { auditPlugins } from "../src/auditors/plugins.js";
import type { OpenClawConfig } from "../src/types.js";

describe("auditPlugins", () => {
  it("returns empty when no plugins configured", () => {
    const config: OpenClawConfig = {};
    const results = auditPlugins(config);
    expect(results).toHaveLength(0);
  });

  it("warns when installed plugin is not in allow list", () => {
    const config: OpenClawConfig = {
      plugins: {
        allow: ["telegram"],
        installs: {
          "lossless-claw": {
            source: "npm",
            installPath: "/home/ubuntu/.openclaw/extensions/lossless-claw",
            version: "0.3.0",
          },
        },
      },
    };
    const results = auditPlugins(config);
    expect(
      results.some((r) => r.status === "warn" && r.check.includes("lossless-claw"))
    ).toBe(true);
  });

  it("reports stale plugins installed over 90 days ago", () => {
    const oldDate = new Date(Date.now() - 100 * 86400000).toISOString();
    const config: OpenClawConfig = {
      plugins: {
        allow: ["old-plugin"],
        installs: {
          "old-plugin": {
            source: "npm",
            installPath: "/path",
            version: "1.0.0",
            installedAt: oldDate,
          },
        },
      },
    };
    const results = auditPlugins(config);
    expect(
      results.some((r) => r.status === "info" && r.check.includes("age"))
    ).toBe(true);
  });

  it("reports known bundled plugins as pass", () => {
    const config: OpenClawConfig = {
      plugins: {
        allow: ["telegram", "browser"],
        entries: {},
        installs: {},
      },
    };
    const results = auditPlugins(config);
    expect(
      results.some((r) => r.status === "pass" && r.message.includes("bundled"))
    ).toBe(true);
  });

  it("reports unknown plugins without installs as info", () => {
    const config: OpenClawConfig = {
      plugins: {
        allow: ["some-custom-plugin"],
        entries: {},
        installs: {},
      },
    };
    const results = auditPlugins(config);
    expect(
      results.some((r) => r.status === "info" && r.check.includes("some-custom-plugin"))
    ).toBe(true);
  });
});
