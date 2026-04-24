import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { auditBootstrapFiles } from "../src/auditors/bootstrap-files.js";
import type { OpenClawConfig } from "../src/types.js";

const TEST_DIR = join(process.cwd(), "__test_bootstrap__");

// macOS default APFS/HFS+ is case-insensitive, so `MEMORY.md` and `memory.md`
// map to the same inode and can't coexist in a single directory. Linux is
// case-sensitive. Detect at runtime so tests work on both.
function detectCaseSensitiveFS(): boolean {
  const probe = join(TEST_DIR, "__case_probe__");
  mkdirSync(probe, { recursive: true });
  writeFileSync(join(probe, "a"), "");
  try {
    writeFileSync(join(probe, "A"), "");
    const entries = readdirSync(probe);
    return entries.includes("a") && entries.includes("A");
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

function makeConfig(workspace: string, overrides?: Record<string, unknown>): OpenClawConfig {
  return {
    agents: {
      defaults: {
        workspace,
        ...overrides,
      },
      list: [{ id: "main", name: "test", workspace, agentDir: workspace }],
    },
  };
}

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("auditBootstrapFiles", () => {
  it("fails when workspace does not exist", () => {
    const config = makeConfig("/nonexistent/path");
    const results = auditBootstrapFiles(config);
    expect(results.some((r) => r.status === "fail" && r.check === "Workspace exists")).toBe(true);
  });

  it("passes for small files", () => {
    writeFileSync(join(TEST_DIR, "SOUL.md"), "# Soul\nBe good.");
    writeFileSync(join(TEST_DIR, "IDENTITY.md"), "# Identity\nI am test.");
    const config = makeConfig(TEST_DIR);
    const results = auditBootstrapFiles(config);
    expect(results.some((r) => r.status === "pass" && r.check === "SOUL.md size")).toBe(true);
    expect(results.some((r) => r.status === "pass" && r.check === "IDENTITY.md size")).toBe(true);
  });

  it("fails for files over the per-file limit", () => {
    const bigContent = "x".repeat(25000);
    writeFileSync(join(TEST_DIR, "TOOLS.md"), bigContent);
    const config = makeConfig(TEST_DIR);
    const results = auditBootstrapFiles(config);
    expect(results.some((r) => r.status === "fail" && r.check === "TOOLS.md size")).toBe(true);
  });

  it("warns for files near the per-file limit", () => {
    const nearLimit = "x".repeat(17000); // 85% of 20K
    writeFileSync(join(TEST_DIR, "MEMORY.md"), nearLimit);
    const config = makeConfig(TEST_DIR);
    const results = auditBootstrapFiles(config);
    expect(results.some((r) => r.status === "warn" && r.check === "MEMORY.md size")).toBe(true);
  });

  it("warns about missing critical files", () => {
    // Empty workspace — no SOUL.md or IDENTITY.md
    const config = makeConfig(TEST_DIR);
    const results = auditBootstrapFiles(config);
    expect(results.some((r) => r.status === "warn" && r.check === "SOUL.md exists")).toBe(true);
    expect(results.some((r) => r.status === "warn" && r.check === "IDENTITY.md exists")).toBe(true);
  });

  it("warns about empty files", () => {
    writeFileSync(join(TEST_DIR, "SOUL.md"), "");
    const config = makeConfig(TEST_DIR);
    const results = auditBootstrapFiles(config);
    expect(results.some((r) => r.status === "warn" && r.check === "SOUL.md content")).toBe(true);
  });

  it("reports total bootstrap budget", () => {
    writeFileSync(join(TEST_DIR, "SOUL.md"), "# Soul\n".repeat(100));
    const config = makeConfig(TEST_DIR);
    const results = auditBootstrapFiles(config);
    expect(results.some((r) => r.check === "Total bootstrap budget")).toBe(true);
  });

  const caseSensitive = detectCaseSensitiveFS();

  it.skipIf(!caseSensitive)(
    "warns when MEMORY.md and memory.md both exist (split-brain)",
    () => {
      writeFileSync(join(TEST_DIR, "MEMORY.md"), "# Upper\nCanonical.");
      writeFileSync(join(TEST_DIR, "memory.md"), "# lower\nShould be merged.");
      const config = makeConfig(TEST_DIR);
      const results = auditBootstrapFiles(config);
      const splitBrain = results.find(
        (r) => r.status === "warn" && r.check === "MEMORY.md split-brain"
      );
      expect(splitBrain).toBeDefined();
      expect(splitBrain!.message).toContain("memory.md");
      expect(splitBrain!.message).toContain("MEMORY.md");
      expect(splitBrain!.fix).toContain("openclaw doctor --fix");
    }
  );

  it("does not warn split-brain when only MEMORY.md exists", () => {
    writeFileSync(join(TEST_DIR, "MEMORY.md"), "# Memory\nOnly one.");
    const config = makeConfig(TEST_DIR);
    const results = auditBootstrapFiles(config);
    expect(results.some((r) => r.check === "MEMORY.md split-brain")).toBe(false);
  });

  it("reports memory directory info", () => {
    mkdirSync(join(TEST_DIR, "memory"), { recursive: true });
    writeFileSync(join(TEST_DIR, "memory", "2026-04-12.md"), "# Notes\nSome notes.");
    const config = makeConfig(TEST_DIR);
    const results = auditBootstrapFiles(config);
    expect(results.some((r) => r.check === "Memory files" && r.status === "info")).toBe(true);
  });
});
