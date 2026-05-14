import { describe, it, expect } from "vitest";
import { auditSettingsPermissions } from "../src/auditors/claude-code/settings-permissions.js";

describe("auditSettingsPermissions", () => {
  it("returns empty array when settings has no permissions field at all", () => {
    expect(auditSettingsPermissions({}, "user")).toHaveLength(0);
  });

  it("info when both allow and deny are unset/empty", () => {
    const results = auditSettingsPermissions({ permissions: {} }, "user");
    expect(results.some(r => r.status === "info" && r.check.toLowerCase().includes("empty"))).toBe(true);
  });

  it("info when deny field is missing entirely (but allow present)", () => {
    const results = auditSettingsPermissions(
      { permissions: { allow: ["Bash(ls:*)"] } },
      "user"
    );
    expect(results.some(r => r.status === "info" && r.check.toLowerCase().includes("deny"))).toBe(true);
  });

  it("warns when allow list exceeds 200 entries", () => {
    const allow = Array.from({ length: 250 }, (_, i) => `Bash(cmd${i}:*)`);
    const results = auditSettingsPermissions({ permissions: { allow, deny: [] } }, "user");
    expect(results.some(r => r.status === "warn" && r.check.includes("Allow list size"))).toBe(true);
  });

  it("fails when allow list exceeds 1000 entries", () => {
    const allow = Array.from({ length: 1100 }, (_, i) => `Bash(cmd${i}:*)`);
    const results = auditSettingsPermissions({ permissions: { allow, deny: [] } }, "user");
    expect(results.some(r => r.status === "fail" && r.check.includes("Allow list size"))).toBe(true);
  });

  it("fails on Bash(*) wildcard", () => {
    const results = auditSettingsPermissions(
      { permissions: { allow: ["Bash(*)"], deny: [] } },
      "user"
    );
    expect(results.some(r => r.status === "fail" && r.check.includes("Bash(*)"))).toBe(true);
  });

  it("fails on Read(*) wildcard", () => {
    const results = auditSettingsPermissions(
      { permissions: { allow: ["Read(*)"], deny: [] } },
      "user"
    );
    expect(results.some(r => r.status === "fail" && r.check.includes("Read(*)"))).toBe(true);
  });

  it("warns on Bash(rm:*), Bash(sudo:*), Bash(curl:*)", () => {
    const results = auditSettingsPermissions(
      { permissions: { allow: ["Bash(rm:*)", "Bash(sudo:*)", "Bash(curl:*)"], deny: [] } },
      "user"
    );
    const warns = results.filter(r => r.status === "warn" && r.check.includes("Over-permissive"));
    expect(warns.length).toBeGreaterThanOrEqual(3);
  });

  it("warns on broad //Users/ path with no restrictive suffix", () => {
    const results = auditSettingsPermissions(
      { permissions: { allow: ["Read(//Users/michael)"], deny: [] } },
      "user"
    );
    expect(results.some(r => r.status === "warn" && r.check.includes("Over-permissive"))).toBe(true);
  });

  it("fails when an entry is in both allow and deny", () => {
    const results = auditSettingsPermissions(
      { permissions: { allow: ["Bash(ls:*)"], deny: ["Bash(ls:*)"] } },
      "user"
    );
    expect(results.some(r => r.status === "fail" && r.check.toLowerCase().includes("conflict"))).toBe(true);
  });

  it("clean config produces no fail results", () => {
    const results = auditSettingsPermissions(
      {
        permissions: {
          allow: ["Bash(ls:*)", "Bash(git:status)", "Read(/Users/me/projects/**)"],
          deny: ["Bash(rm:-rf:/)"],
        },
      },
      "user"
    );
    expect(results.every(r => r.status !== "fail")).toBe(true);
  });
});
