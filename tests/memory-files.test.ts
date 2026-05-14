import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from "fs";
import { auditMemoryFiles } from "../src/auditors/claude-code/memory-files.js";

describe("auditMemoryFiles", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array when no paths supplied", () => {
    expect(auditMemoryFiles([])).toHaveLength(0);
  });

  it("info when CLAUDE.md is over 20K chars (user scope)", () => {
    vi.mocked(readFileSync).mockReturnValue("x".repeat(25_000));
    vi.mocked(existsSync).mockReturnValue(false);
    const results = auditMemoryFiles(["/Users/me/.claude/CLAUDE.md"]);
    expect(results.some(r => r.status === "info" && r.check.toLowerCase().includes("size"))).toBe(true);
  });

  it("warns when CLAUDE.md is over 40K chars", () => {
    vi.mocked(readFileSync).mockReturnValue("x".repeat(45_000));
    vi.mocked(existsSync).mockReturnValue(false);
    const results = auditMemoryFiles(["/Users/me/.claude/CLAUDE.md"]);
    expect(results.some(r => r.status === "warn" && r.check.toLowerCase().includes("size"))).toBe(true);
  });

  it("fails when CLAUDE.md is over 80K chars", () => {
    vi.mocked(readFileSync).mockReturnValue("x".repeat(85_000));
    vi.mocked(existsSync).mockReturnValue(false);
    const results = auditMemoryFiles(["/Users/me/.claude/CLAUDE.md"]);
    expect(results.some(r => r.status === "fail" && r.check.toLowerCase().includes("size"))).toBe(true);
  });

  it("project-scope CLAUDE.md is checked separately", () => {
    vi.mocked(readFileSync).mockReturnValue("x".repeat(45_000));
    vi.mocked(existsSync).mockReturnValue(false);
    const results = auditMemoryFiles(["/Users/me/work/proj/CLAUDE.md"]);
    expect(results.some(r => r.status === "warn" && r.message.toLowerCase().includes("project"))).toBe(true);
  });

  it("info when both user and project CLAUDE.md exist", () => {
    vi.mocked(readFileSync).mockReturnValue("# small");
    vi.mocked(existsSync).mockReturnValue(false);
    const results = auditMemoryFiles([
      "/Users/me/.claude/CLAUDE.md",
      "/Users/me/work/proj/CLAUDE.md",
    ]);
    expect(results.some(r => r.status === "info" && r.check.toLowerCase().includes("both"))).toBe(true);
  });

  it("warns on broken @-import in CLAUDE.md", () => {
    vi.mocked(readFileSync).mockReturnValue("See @./missing-file.md for details.");
    vi.mocked(existsSync).mockReturnValue(false);
    const results = auditMemoryFiles(["/Users/me/.claude/CLAUDE.md"]);
    expect(results.some(r => r.status === "warn" && r.check.toLowerCase().includes("import"))).toBe(true);
  });

  it("does not warn when @-import target exists", () => {
    vi.mocked(readFileSync).mockReturnValue("See @./existing.md");
    vi.mocked(existsSync).mockReturnValue(true);
    const results = auditMemoryFiles(["/Users/me/.claude/CLAUDE.md"]);
    expect(results.some(r => r.status === "warn" && r.check.toLowerCase().includes("import"))).toBe(false);
  });

  it("clean small CLAUDE.md produces no warn/fail", () => {
    vi.mocked(readFileSync).mockReturnValue("# Short CLAUDE.md\nKeep it small.");
    vi.mocked(existsSync).mockReturnValue(false);
    const results = auditMemoryFiles(["/Users/me/.claude/CLAUDE.md"]);
    expect(results.every(r => r.status !== "warn" && r.status !== "fail")).toBe(true);
  });

  it("handles unreadable file gracefully", () => {
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error("EACCES"); });
    vi.mocked(existsSync).mockReturnValue(false);
    const results = auditMemoryFiles(["/Users/me/.claude/CLAUDE.md"]);
    // Should not throw; should report a warn about readability
    expect(results.some(r => r.status === "warn" && r.check.toLowerCase().includes("readable"))).toBe(true);
  });
});
