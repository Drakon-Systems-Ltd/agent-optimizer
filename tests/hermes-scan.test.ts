import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { runSecurityScan } from "../src/auditors/openclaw/security-scan.js";

// Hermes skills dir participates in the security scan the same way OpenClaw
// workspace skills do — via an explicit hermesSkillsDir (defaults to
// ~/.hermes/skills in production; tests stay hermetic with a temp dir).
const TEST_DIR = join(process.cwd(), "__test_hermes_scan__");
const HERMES_SKILLS = join(TEST_DIR, "hermes-skills");

beforeEach(() => {
  mkdirSync(HERMES_SKILLS, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe("security scan — Hermes skills", () => {
  it("scans skills under hermesSkillsDir", async () => {
    const skill = join(HERMES_SKILLS, "hermes-good-skill");
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), "# Good Hermes Skill\nDoes nothing suspicious.");

    const results = await runSecurityScan({
      config: "nonexistent",
      workspace: join(TEST_DIR, "ws"),
      hooksDir: join(TEST_DIR, "hooks"),
      extensionsDir: join(TEST_DIR, "extensions"),
      hermesSkillsDir: HERMES_SKILLS,
    });

    const hermesResult = results.find(
      (r) => r.category === "Hermes Skills Scan" && r.check.includes("hermes-good-skill")
    );
    expect(hermesResult).toBeDefined();
    expect(hermesResult!.status).toBe("pass");
  });

  it("flags a suspicious Hermes skill", async () => {
    const skill = join(HERMES_SKILLS, "hermes-billing-skill");
    mkdirSync(skill, { recursive: true });
    writeFileSync(
      join(skill, "billing.py"),
      'def charge(uid):\n    return _post("/billing/charge", {"user_id": uid})\n'
    );

    const results = await runSecurityScan({
      config: "nonexistent",
      workspace: join(TEST_DIR, "ws"),
      hooksDir: join(TEST_DIR, "hooks"),
      extensionsDir: join(TEST_DIR, "extensions"),
      hermesSkillsDir: HERMES_SKILLS,
    });

    const hermesResult = results.find(
      (r) => r.category === "Hermes Skills Scan" && r.check.includes("hermes-billing-skill")
    );
    expect(hermesResult).toBeDefined();
    expect(["warn", "fail"]).toContain(hermesResult!.status);
  });

  it("emits no Hermes results when the dir does not exist", async () => {
    const results = await runSecurityScan({
      config: "nonexistent",
      workspace: join(TEST_DIR, "ws"),
      hooksDir: join(TEST_DIR, "hooks"),
      extensionsDir: join(TEST_DIR, "extensions"),
      hermesSkillsDir: join(TEST_DIR, "does-not-exist"),
    });
    expect(results.some((r) => r.category.startsWith("Hermes"))).toBe(false);
  });
});
