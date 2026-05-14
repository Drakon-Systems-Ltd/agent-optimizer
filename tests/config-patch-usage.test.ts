import { describe, it, expect } from "vitest";
import { auditConfigPatchUsage } from "../src/auditors/openclaw/config-patch-usage.js";
import type { OpenClawConfig } from "../src/types.js";

describe("auditConfigPatchUsage", () => {
  it("returns empty when no hooks or tools configured", () => {
    const config: OpenClawConfig = {};
    const results = auditConfigPatchUsage(config);
    expect(results).toHaveLength(0);
  });

  it("returns empty for benign hook entries", () => {
    const config: OpenClawConfig = {
      hooks: {
        internal: {
          enabled: true,
          entries: {
            "cortex-memory": { enabled: true, event: "message" },
            "session-memory": { enabled: true },
          },
        },
      },
    };
    const results = auditConfigPatchUsage(config);
    expect(results).toHaveLength(0);
  });

  it("warns when a legacy handler module references config.patch", () => {
    const config: OpenClawConfig = {
      hooks: {
        internal: {
          enabled: true,
          handlers: [
            { event: "message", module: "./hooks/auto-tune/config.patch.js" },
          ],
        },
      },
    };
    const results = auditConfigPatchUsage(config);
    expect(results.some((r) => r.status === "warn" && r.check.includes("config.patch"))).toBe(true);
  });

  it("warns when a hook entry env references config.apply", () => {
    const config: OpenClawConfig = {
      hooks: {
        internal: {
          enabled: true,
          entries: {
            "auto-tune": {
              enabled: true,
              env: { COMMAND: "openclaw gateway config.apply --file /tmp/p.json" },
            },
          },
        },
      },
    };
    const results = auditConfigPatchUsage(config);
    expect(results.some((r) => r.status === "warn" && r.check.includes("auto-tune"))).toBe(true);
  });

  it("warns when an agent tool allowlist exposes config.patch/apply", () => {
    const config: OpenClawConfig = {
      agents: {
        list: [
          {
            id: "main",
            name: "main",
            workspace: "~/clawd",
            agentDir: "~/.openclaw/agents/main/agent",
            tools: { alsoAllow: ["gateway.config.patch", "gateway.config.apply"] },
          },
        ],
      },
    };
    const results = auditConfigPatchUsage(config);
    expect(results.some((r) => r.status === "warn" && r.check.includes("tool allowlist"))).toBe(true);
  });

  it("includes the fix pointer to the v2026.4.23 allowlist", () => {
    const config: OpenClawConfig = {
      hooks: {
        internal: {
          enabled: true,
          handlers: [{ event: "message", module: "./config.patch.js" }],
        },
      },
    };
    const results = auditConfigPatchUsage(config);
    const warn = results.find((r) => r.status === "warn");
    expect(warn?.fix).toBeDefined();
    expect(warn!.fix!.toLowerCase()).toMatch(/allowlist|prompt|model|mention/);
  });
});
