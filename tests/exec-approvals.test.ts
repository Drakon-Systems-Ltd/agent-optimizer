import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));
import { existsSync, readFileSync } from "fs";
import { auditExecApprovals } from "../src/auditors/exec-approvals.js";

describe("auditExecApprovals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty when file does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(auditExecApprovals()).toHaveLength(0);
  });

  it("warns when file is malformed JSON", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("{ not valid json" as never);
    const results = auditExecApprovals();
    expect(results.some(r => r.status === "warn" && r.check.includes("readable"))).toBe(true);
  });

  it("warns when approvals older than 90 days are present", () => {
    const oldDate = new Date(Date.now() - 100 * 86400000).toISOString();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      approvals: [
        { command: "rm", grantedAt: oldDate },
        { command: "ls", grantedAt: new Date().toISOString() },
      ],
    }) as never);
    const results = auditExecApprovals();
    expect(results.some(r => r.status === "warn" && r.check.includes("Stale"))).toBe(true);
  });

  it("does not warn when all approvals are recent", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      approvals: [
        { command: "ls", grantedAt: new Date().toISOString() },
      ],
    }) as never);
    const results = auditExecApprovals();
    expect(results.some(r => r.check.includes("Stale"))).toBe(false);
  });

  it("does not warn when approvals array is missing", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ socketPath: "/tmp/sock" }) as never);
    const results = auditExecApprovals();
    expect(results.some(r => r.check.includes("Stale"))).toBe(false);
  });

  it("ignores approvals without grantedAt", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      approvals: [{ command: "ls" }],
    }) as never);
    const results = auditExecApprovals();
    expect(results.some(r => r.check.includes("Stale"))).toBe(false);
  });
});
