import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { auditAuthProfiles } from "../src/auditors/auth-profiles.js";
import type { OpenClawConfig } from "../src/types.js";

const TEST_DIR = join(process.cwd(), "__test_auth_profiles__");
const AGENT_DIR = join(TEST_DIR, "agents", "main", "agent");
// auditAuthProfiles resolves .env via dirname(agentDir)/../.env
// → dirname(__test/agents/main/agent) = __test/agents/main → /../.env → __test/agents/.env
const ENV_PATH = join(TEST_DIR, "agents", ".env");
const AUTH_FILE = join(AGENT_DIR, "auth-profiles.json");

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(AGENT_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeAuth(profiles: Record<string, unknown>) {
  writeFileSync(
    AUTH_FILE,
    JSON.stringify({ version: 1, profiles })
  );
}

describe("auditAuthProfiles", () => {
  it("fails when no auth-profiles.json exists", () => {
    const results = auditAuthProfiles({} as OpenClawConfig, AGENT_DIR);
    const fail = results.find((r) => r.check === "Auth profiles exist");
    expect(fail).toBeDefined();
    expect(fail!.status).toBe("fail");
  });

  it("fails when profiles object is empty", () => {
    writeAuth({});
    const results = auditAuthProfiles({} as OpenClawConfig, AGENT_DIR);
    expect(
      results.some((r) => r.check === "Auth profiles configured" && r.status === "fail")
    ).toBe(true);
  });

  it("passes a valid non-expiring profile", () => {
    writeAuth({
      "anthropic:default": { type: "api-key", provider: "anthropic", key: "sk-ant-aaaaaaaaaaaaaaaaaaaaaaaaa" },
    });
    const results = auditAuthProfiles({} as OpenClawConfig, AGENT_DIR);
    expect(results.some((r) => r.status === "fail")).toBe(false);
  });

  it("flags expired tokens as fail when no other profile covers the provider", () => {
    writeAuth({
      "openai:default": {
        type: "oauth",
        provider: "openai",
        token: "tok-aaaaaaaaaaaaaaaaaaaaaa",
        expires: Date.now() - 86_400_000, // 1 day ago
      },
    });
    const results = auditAuthProfiles({} as OpenClawConfig, AGENT_DIR);
    const expired = results.find((r) => r.check.startsWith("Token expiry"));
    expect(expired).toBeDefined();
    expect(expired!.status).toBe("fail");
    expect(expired!.fix).toContain("openclaw models auth login");
  });

  it("downgrades expired token to info when another provider profile is valid", () => {
    writeAuth({
      "anthropic:expired": {
        type: "oauth",
        provider: "anthropic",
        token: "tok-aaaaaaaaaaaaaaaaaaaaaa",
        expires: Date.now() - 86_400_000,
      },
      "anthropic:fresh": {
        type: "oauth",
        provider: "anthropic",
        token: "tok-bbbbbbbbbbbbbbbbbbbbbb",
        expires: Date.now() + 86_400_000,
      },
    });
    const results = auditAuthProfiles({} as OpenClawConfig, AGENT_DIR);
    const expired = results.find((r) => r.check === "Token expiry: anthropic:expired");
    expect(expired).toBeDefined();
    expect(expired!.status).toBe("info");
  });

  it("warns on token expiring within an hour", () => {
    writeAuth({
      "anthropic:default": {
        type: "oauth",
        provider: "anthropic",
        token: "tok-aaaaaaaaaaaaaaaaaaaaaa",
        expires: Date.now() + 30 * 60 * 1000,
      },
    });
    const results = auditAuthProfiles({} as OpenClawConfig, AGENT_DIR);
    const warn = results.find((r) => r.check.startsWith("Token expiry"));
    expect(warn!.status).toBe("warn");
  });

  it("flags missing auth for primary model provider", () => {
    writeAuth({
      "openai:default": { type: "api-key", provider: "openai", key: "sk-aaaaaaaaaaaaaaaaaaaaaa" },
    });
    const config = {
      agents: { defaults: { model: { primary: "anthropic/claude-opus-4-7" } } },
    } as OpenClawConfig;
    const results = auditAuthProfiles(config, AGENT_DIR);
    expect(
      results.some(
        (r) => r.check === "Auth for primary model (anthropic)" && r.status === "fail"
      )
    ).toBe(true);
  });

  it("does not require auth for local providers (ollama/lm-studio)", () => {
    writeAuth({
      "openai:default": { type: "api-key", provider: "openai", key: "sk-aaaaaaaaaaaaaaaaaaaaaa" },
    });
    const config = {
      agents: { defaults: { model: { primary: "ollama/llama3" } } },
    } as OpenClawConfig;
    const results = auditAuthProfiles(config, AGENT_DIR);
    expect(results.some((r) => r.check.startsWith("Auth for primary model"))).toBe(false);
  });

  it("flags duplicate API keys across profiles", () => {
    const sharedKey = "sk-shared-zzzzzzzzzzzzzzzzzzzz";
    writeAuth({
      "p1": { type: "api-key", provider: "openai", key: sharedKey },
      "p2": { type: "api-key", provider: "openai", key: sharedKey },
    });
    const results = auditAuthProfiles({} as OpenClawConfig, AGENT_DIR);
    expect(
      results.some((r) => r.check === "Duplicate API keys" && r.status === "info")
    ).toBe(true);
  });

  it("flags placeholder credentials in adjacent .env file", () => {
    writeAuth({
      "anthropic:default": { type: "api-key", provider: "anthropic", key: "sk-ant-aaaaaaaaaaaaaaaaaaaaaaaa" },
    });
    writeFileSync(ENV_PATH, "OPENCLAW_GATEWAY_PASSWORD=change-me\nOTHER=fine\n");
    const results = auditAuthProfiles({} as OpenClawConfig, AGENT_DIR);
    expect(
      results.some(
        (r) =>
          r.check === "Placeholder credential: OPENCLAW_GATEWAY_PASSWORD" &&
          r.status === "fail"
      )
    ).toBe(true);
  });
});
