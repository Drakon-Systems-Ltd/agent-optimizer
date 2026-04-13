import { describe, it, expect } from "vitest";
import { auditChannelSecurity } from "../src/auditors/channel-security.js";
import type { OpenClawConfig } from "../src/types.js";

describe("auditChannelSecurity", () => {
  it("reports no channels configured as info", () => {
    const config: OpenClawConfig = {};
    const results = auditChannelSecurity(config);
    expect(results.some((r) => r.status === "info" && r.message.includes("No channels"))).toBe(true);
  });

  it("fails when DM policy is open", () => {
    const config: OpenClawConfig = {
      channels: {
        defaults: { dmPolicy: "open" },
        telegram: {},
      },
    };
    const results = auditChannelSecurity(config);
    expect(results.some((r) => r.status === "fail" && r.check.includes("Default DM policy"))).toBe(true);
  });

  it("passes with pairing DM policy", () => {
    const config: OpenClawConfig = {
      channels: {
        defaults: { dmPolicy: "pairing", groupPolicy: "allowlist" },
        telegram: {},
      },
    };
    const results = auditChannelSecurity(config);
    expect(results.some((r) => r.status === "pass" && r.check === "Default DM policy")).toBe(true);
  });

  it("warns about open group policy", () => {
    const config: OpenClawConfig = {
      channels: {
        defaults: { groupPolicy: "open" },
        telegram: {},
      },
    };
    const results = auditChannelSecurity(config);
    expect(results.some((r) => r.status === "warn" && r.check === "Default group policy")).toBe(true);
  });

  it("warns about mutable IDs on Discord with allowlist", () => {
    const config: OpenClawConfig = {
      channels: {
        defaults: { dmPolicy: "allowlist" },
        discord: { dmPolicy: "allowlist", allowFrom: ["user123"] },
      },
    };
    const results = auditChannelSecurity(config);
    expect(results.some((r) => r.status === "warn" && r.check.includes("mutable IDs"))).toBe(true);
  });

  it("fails when allowlist policy has no allowFrom entries", () => {
    const config: OpenClawConfig = {
      channels: {
        telegram: { dmPolicy: "allowlist" },
      },
    };
    const results = auditChannelSecurity(config);
    expect(results.some((r) => r.status === "fail" && r.check.includes("allowlist"))).toBe(true);
  });

  it("counts active channels", () => {
    const config: OpenClawConfig = {
      channels: {
        telegram: {},
        whatsapp: {},
        discord: {},
      },
    };
    const results = auditChannelSecurity(config);
    expect(results.some((r) => r.message.includes("3 channel(s)"))).toBe(true);
  });
});
