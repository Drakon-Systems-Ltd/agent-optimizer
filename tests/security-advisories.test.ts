import { describe, it, expect } from "vitest";
import { auditSecurityAdvisories } from "../src/auditors/openclaw/security-advisories.js";

describe("auditSecurityAdvisories", () => {
  it("returns info when version is unknown", () => {
    const results = auditSecurityAdvisories("unknown");
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("info");
    expect(results[0].message).toContain("Could not detect");
  });

  it("returns pass when on latest version", () => {
    const results = auditSecurityAdvisories("2026.4.24");
    expect(results.some((r) => r.check === "Security advisories" && r.status === "pass")).toBe(true);
  });

  it("flags config.patch bypass for pre-4.14", () => {
    const results = auditSecurityAdvisories("2026.4.12");
    expect(results.some((r) => r.check === "config.patch gateway bypass" && r.status === "fail")).toBe(true);
  });

  it("flags approval prompt secret leak for pre-4.15", () => {
    const results = auditSecurityAdvisories("2026.4.14");
    expect(results.some((r) => r.check === "Approval prompt secret leak" && r.status === "fail")).toBe(true);
  });

  it("flags workspace symlink traversal for pre-4.15", () => {
    const results = auditSecurityAdvisories("2026.4.14");
    expect(results.some((r) => r.check === "Workspace symlink traversal" && r.status === "fail")).toBe(true);
  });

  it("flags empty approver bypass for pre-4.12", () => {
    const results = auditSecurityAdvisories("2026.4.10");
    expect(results.some((r) => r.check === "Empty approver bypass" && r.status === "warn")).toBe(true);
  });

  it("includes advisory summary with upgrade target", () => {
    const results = auditSecurityAdvisories("2026.4.10");
    const summary = results.find((r) => r.check === "Advisory summary");
    expect(summary).toBeDefined();
    expect(summary!.message).toContain("security advisories");
    expect(summary!.message).toContain("upgrade to");
  });

  it("reports correct count of critical vs warnings", () => {
    const results = auditSecurityAdvisories("2026.4.12");
    const summary = results.find((r) => r.check === "Advisory summary");
    expect(summary).toBeDefined();
    // Pre-4.14 should have config.patch (fail) + several warns from 4.14
    // Pre-4.15 should have approval prompt + symlink (fail) + several warns
    const criticals = results.filter((r) => r.status === "fail" && r.check !== "Advisory summary");
    const warnings = results.filter((r) => r.status === "warn" && r.check !== "Advisory summary");
    expect(criticals.length).toBeGreaterThan(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("does not flag issues already fixed in detected version", () => {
    const results = auditSecurityAdvisories("2026.4.14");
    // 4.14 fixes should NOT be flagged
    expect(results.some((r) => r.check === "config.patch gateway bypass")).toBe(false);
    // But 4.15 fixes SHOULD be flagged
    expect(results.some((r) => r.check === "Approval prompt secret leak")).toBe(true);
  });

  it("flags config.patch allowlist lockdown for pre-4.23", () => {
    const results = auditSecurityAdvisories("2026.4.22");
    expect(
      results.some(
        (r) => r.check === "config.patch allowlist lockdown" && r.status === "warn"
      )
    ).toBe(true);
  });

  it("does not flag config.patch lockdown once on 4.23", () => {
    const results = auditSecurityAdvisories("2026.4.23");
    expect(
      results.some((r) => r.check === "config.patch allowlist lockdown")
    ).toBe(false);
  });

  it("flags removed registerEmbeddedExtensionFactory for pre-4.24", () => {
    const results = auditSecurityAdvisories("2026.4.23");
    const advisory = results.find(
      (r) => r.check === "registerEmbeddedExtensionFactory removed"
    );
    expect(advisory).toBeDefined();
    expect(advisory!.status).toBe("fail");
    expect(advisory!.fix).toContain("registerAgentToolResultMiddleware");
  });

  it("nudges to latest stable for pre-4.24", () => {
    const results = auditSecurityAdvisories("2026.4.23");
    expect(
      results.some((r) => r.check === "Behind latest stable" && r.status === "warn")
    ).toBe(true);
  });

  it("returns clean once on 2026.4.24", () => {
    const results = auditSecurityAdvisories("2026.4.24");
    expect(
      results.some((r) => r.check === "registerEmbeddedExtensionFactory removed")
    ).toBe(false);
    expect(results.some((r) => r.check === "Behind latest stable")).toBe(false);
    expect(
      results.some((r) => r.check === "Security advisories" && r.status === "pass")
    ).toBe(true);
  });
});
