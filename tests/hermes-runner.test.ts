import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { runHermesAuditors, discoverHermesProfiles } from "../src/auditors/hermes/index.js";
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

describe("runHermesAuditors — named profiles", () => {
  function writeProfile(name: string, yaml: string): string {
    const dir = join(TEST_DIR, "profiles", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.yaml"), yaml);
    return dir;
  }

  it("emits no profile findings when profiles/ is absent", () => {
    const dir = writeConfig(HEALTHY_CONFIG);
    const results = runHermesAuditors(dir);
    expect(results.some((r) => r.category === "Hermes Profiles")).toBe(false);
    expect(results.some((r) => r.check.startsWith("[profile "))).toBe(false);
  });

  it("discovers live profiles and lists them", () => {
    const dir = writeConfig(HEALTHY_CONFIG);
    writeProfile("work", HEALTHY_CONFIG);
    writeProfile("home", HEALTHY_CONFIG);
    expect(discoverHermesProfiles(dir).map((p) => p.name)).toEqual(["home", "work"]);
    const info = runHermesAuditors(dir).find((r) => r.category === "Hermes Profiles");
    expect(info?.status).toBe("info");
    expect(info?.message).toContain("2 named Hermes profile(s)");
    expect(info?.message).toContain("home, work");
    expect(info?.system).toBe("hermes");
  });

  it("audits each profile config and labels findings with the profile name", () => {
    const dir = writeConfig(HEALTHY_CONFIG);
    writeProfile(
      "work",
      [
        "model:",
        "  default: claude-sonnet-4-6",
        `fallback_providers: "[{'provider': 'openrouter'}]"`,
        "_config_version: 11",
        "cron:",
        "  model_drift_guard: true",
        "",
      ].join("\n")
    );
    const results = runHermesAuditors(dir);
    // root stays clean
    expect(results.filter((r) => r.status === "fail" && !r.check.startsWith("[profile "))).toHaveLength(0);
    // profile findings are labelled, stamped hermes, still read-only
    const fail = results.find((r) => r.check === "[profile work] fallback_providers stored as list");
    expect(fail?.status).toBe("fail");
    expect(fail?.system).toBe("hermes");
    expect(results.find((r) => r.check === "[profile work] Config schema version")?.status).toBe("warn");
    expect(results.find((r) => r.check === "[profile work] cron.model_drift_guard")?.status).toBe("warn");
    expect(results.every((r) => r.autoFixable !== true && r.apply === undefined)).toBe(true);
  });

  it("reads a profile's own auth.json", () => {
    const dir = writeConfig(HEALTHY_CONFIG);
    const profileDir = writeProfile("work", HEALTHY_CONFIG);
    writeFileSync(
      join(profileDir, "auth.json"),
      JSON.stringify({ providers: { openai: { expires_at: Date.now() - 3600_000 } } })
    );
    const results = runHermesAuditors(dir);
    expect(results.find((r) => r.check === "[profile work] Token expiry: openai")?.status).toBe("warn");
    expect(results.some((r) => r.check === "Token expiry: openai")).toBe(false);
  });

  it("skips dot-directories, tombstoned profiles and dirs without config.yaml", () => {
    const dir = writeConfig(HEALTHY_CONFIG);
    writeProfile("live", HEALTHY_CONFIG);
    writeProfile(".hidden", HEALTHY_CONFIG);
    writeProfile("gone", HEALTHY_CONFIG);
    mkdirSync(join(TEST_DIR, "profiles", ".deleted"), { recursive: true });
    writeFileSync(join(TEST_DIR, "profiles", ".deleted", "gone"), "deleted\n");
    mkdirSync(join(TEST_DIR, "profiles", "empty"), { recursive: true });
    writeFileSync(join(TEST_DIR, "profiles", "not-a-dir"), "");
    expect(discoverHermesProfiles(dir).map((p) => p.name)).toEqual(["live"]);
    const checks = runHermesAuditors(dir).map((r) => r.check);
    expect(checks.some((c) => c.startsWith("[profile live]"))).toBe(true);
    expect(checks.some((c) => c.startsWith("[profile gone]"))).toBe(false);
    expect(checks.some((c) => c.startsWith("[profile .hidden]"))).toBe(false);
    expect(checks.some((c) => c.startsWith("[profile empty]"))).toBe(false);
  });

  it("can be told to audit the root only", () => {
    const dir = writeConfig(HEALTHY_CONFIG);
    writeProfile("work", HEALTHY_CONFIG);
    const results = runHermesAuditors(dir, { includeProfiles: false });
    expect(results.some((r) => r.check.startsWith("[profile "))).toBe(false);
  });
});

describe("runHermesAuditors — 0.21.2 drift checks through the runner", () => {
  it("passes the config-version check on a current schema and warns below the floor", () => {
    const ok = runHermesAuditors(writeConfig(`${HEALTHY_CONFIG}_config_version: 44\n`));
    expect(ok.find((r) => r.check === "Config schema version")?.status).toBe("pass");
    const old = runHermesAuditors(writeConfig(`${HEALTHY_CONFIG}_config_version: 5\n`));
    const r = old.find((r) => r.check === "Config schema version");
    expect(r?.status).toBe("warn");
    expect(r?.system).toBe("hermes");
  });

  it("warns on removed keys through the runner", () => {
    const results = runHermesAuditors(
      writeConfig(`${HEALTHY_CONFIG}gateway:\n  multiplex_profile_allowlist: [work]\nplugins:\n  enabled: [nemo_relay]\n`)
    );
    expect(results.find((r) => r.check === "gateway.multiplex_profile_allowlist")?.status).toBe("warn");
    expect(results.find((r) => r.check === "Legacy Relay plugin in plugins.enabled")?.status).toBe("warn");
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
