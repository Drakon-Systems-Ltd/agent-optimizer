import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { runHermesAuditors } from "../src/auditors/hermes/index.js";
import { auditHermesAuthHygiene } from "../src/auditors/hermes/auth-hygiene.js";

// End-to-end runner tests: real YAML fixtures written to a temp dir (never the
// real ~/.hermes), exercised through runHermesAuditors exactly as runFullAudit
// invokes it.
const TEST_DIR = join(process.cwd(), "__test_hermes__");

function writeConfig(yaml: string): string {
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(join(TEST_DIR, "config.yaml"), yaml);
  return TEST_DIR;
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

const HEALTHY_CONFIG = [
  "model:",
  "  default: claude-sonnet-4-6",
  "  provider: anthropic",
  "  base_url: https://api.anthropic.com",
  "fallback_providers:",
  "  - provider: openrouter",
  "    model: claude-sonnet-4-6",
  "approvals:",
  "  mode: always",
  "  timeout: 300",
  "command_allowlist:",
  "  - git",
  '  - "npm test"',
  "telegram:",
  "  allowed_chats:",
  "    - 12345",
  "memory:",
  "  memory_enabled: true",
  "  write_approval: true",
  "compression:",
  "  enabled: true",
  "  threshold: 0.8",
  "prompt_caching:",
  "  cache_ttl: 1h",
  "skills:",
  "  inline_shell: false",
  "  guard_agent_created: true",
  "privacy:",
  "  redact_pii: true",
  "",
].join("\n");

describe("runHermesAuditors", () => {
  it("stamps system: hermes on every result", () => {
    const dir = writeConfig(HEALTHY_CONFIG);
    const results = runHermesAuditors(dir);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.system === "hermes")).toBe(true);
  });

  it("emits no fails and no autoFixable results on a healthy config (read-only)", () => {
    const dir = writeConfig(HEALTHY_CONFIG);
    const results = runHermesAuditors(dir);
    expect(results.filter((r) => r.status === "fail")).toHaveLength(0);
    expect(results.every((r) => r.autoFixable !== true && r.apply === undefined)).toBe(true);
  });

  it("fires the string-not-list FAIL through the full runner", () => {
    const dir = writeConfig(
      [
        "model:",
        "  default: claude-sonnet-4-6",
        `fallback_providers: "[{'provider': 'openrouter'}]"`,
        "",
      ].join("\n")
    );
    const results = runHermesAuditors(dir);
    const fail = results.find(
      (r) => r.status === "fail" && r.check === "fallback_providers stored as list"
    );
    expect(fail).toBeDefined();
    expect(fail!.system).toBe("hermes");
  });

  it("warns instead of crashing on unparseable YAML", () => {
    const dir = writeConfig("model: [unclosed\n  broken: {{{\n");
    const results = runHermesAuditors(dir);
    expect(results.some((r) => r.status === "warn" && r.check === "config.yaml parseable")).toBe(true);
  });

  it("warns when config.yaml is missing", () => {
    const results = runHermesAuditors(TEST_DIR);
    expect(results.some((r) => r.status === "warn" && r.check === "config.yaml exists")).toBe(true);
  });

  it("audits an empty config.yaml without crashing", () => {
    const dir = writeConfig("");
    const results = runHermesAuditors(dir);
    expect(results.some((r) => r.status === "fail" && r.check === "Default model set")).toBe(true);
  });

  it("includes auth-hygiene findings when auth.json has an expired provider", () => {
    const dir = writeConfig(HEALTHY_CONFIG);
    writeFileSync(
      join(dir, "auth.json"),
      JSON.stringify({
        version: 1,
        active_provider: "anthropic",
        providers: {
          anthropic: { type: "oauth", expires_at: Date.now() - 3600_000 },
        },
      })
    );
    const results = runHermesAuditors(dir);
    const warn = results.find((r) => r.check === "Token expiry: anthropic");
    expect(warn).toBeDefined();
    expect(warn!.status).toBe("warn");
    expect(warn!.system).toBe("hermes");
  });
});

describe("auditHermesAuthHygiene", () => {
  const AUTH_PATH = join(TEST_DIR, "auth.json");

  it("emits nothing when auth.json is absent", () => {
    expect(auditHermesAuthHygiene(join(TEST_DIR, "nope.json"))).toHaveLength(0);
  });

  it("warns on an expired epoch-millis expiry", () => {
    writeFileSync(
      AUTH_PATH,
      JSON.stringify({ providers: { openai: { expires_at: Date.now() - 7200_000 } } })
    );
    const results = auditHermesAuthHygiene(AUTH_PATH);
    const r = results.find((x) => x.check === "Token expiry: openai");
    expect(r!.status).toBe("warn");
    expect(r!.message).toContain("expired");
  });

  it("warns on an expired epoch-seconds expiry", () => {
    writeFileSync(
      AUTH_PATH,
      JSON.stringify({ providers: { openai: { expiry: Math.floor(Date.now() / 1000) - 7200 } } })
    );
    const results = auditHermesAuthHygiene(AUTH_PATH);
    expect(results.some((r) => r.status === "warn" && r.check === "Token expiry: openai")).toBe(true);
  });

  it("warns on an expired ISO-string expiry", () => {
    writeFileSync(
      AUTH_PATH,
      JSON.stringify({ providers: { google: { expires_at: "2020-01-01T00:00:00Z" } } })
    );
    const results = auditHermesAuthHygiene(AUTH_PATH);
    expect(results.some((r) => r.status === "warn" && r.check === "Token expiry: google")).toBe(true);
  });

  it("passes on a still-valid expiry", () => {
    writeFileSync(
      AUTH_PATH,
      JSON.stringify({ providers: { anthropic: { expires_at: Date.now() + 86_400_000 } } })
    );
    const results = auditHermesAuthHygiene(AUTH_PATH);
    const r = results.find((x) => x.check === "Token expiry: anthropic");
    expect(r!.status).toBe("pass");
  });

  it("handles a list-shaped providers entry", () => {
    writeFileSync(
      AUTH_PATH,
      JSON.stringify({ providers: [{ provider: "openai", expires_at: Date.now() - 1000 }] })
    );
    const results = auditHermesAuthHygiene(AUTH_PATH);
    expect(results.some((r) => r.status === "warn" && r.check === "Token expiry: openai")).toBe(true);
  });

  it("emits nothing when entries have no recognisable expiry fields", () => {
    writeFileSync(
      AUTH_PATH,
      JSON.stringify({ providers: { anthropic: { type: "oauth", token: "abc" } } })
    );
    expect(auditHermesAuthHygiene(AUTH_PATH)).toHaveLength(0);
  });

  it("ignores small numbers that look like durations, not timestamps", () => {
    writeFileSync(AUTH_PATH, JSON.stringify({ providers: { x: { expires: 3600 } } }));
    expect(auditHermesAuthHygiene(AUTH_PATH)).toHaveLength(0);
  });

  it("warns (not crashes) on unparseable auth.json", () => {
    writeFileSync(AUTH_PATH, "{not json");
    const results = auditHermesAuthHygiene(AUTH_PATH);
    expect(results.some((r) => r.status === "warn" && r.check === "auth.json readable")).toBe(true);
  });

  it("emits nothing on an unrecognised schema (providers not object/list)", () => {
    writeFileSync(AUTH_PATH, JSON.stringify({ providers: "weird" }));
    expect(auditHermesAuthHygiene(AUTH_PATH)).toHaveLength(0);
  });
});
