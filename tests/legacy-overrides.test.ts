import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { auditLegacyOverrides } from "../src/auditors/openclaw/legacy-overrides.js";
import type { OpenClawConfig } from "../src/types.js";

const TEST_DIR = join(process.cwd(), "__test_legacy_overrides__");
const AGENT_DIR = join(TEST_DIR, "agents", "main", "agent");
const MODELS_FILE = join(AGENT_DIR, "models.json");

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(AGENT_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeModels(content: unknown) {
  writeFileSync(MODELS_FILE, JSON.stringify(content));
}

describe("auditLegacyOverrides", () => {
  it("returns info when models.json is missing", () => {
    const results = auditLegacyOverrides({} as OpenClawConfig, AGENT_DIR);
    expect(results).toHaveLength(1);
    expect(results[0].check).toBe("models.json exists");
    expect(results[0].status).toBe("info");
  });

  it("returns empty when providers section is missing", () => {
    writeModels({ aliases: {} });
    const results = auditLegacyOverrides({} as OpenClawConfig, AGENT_DIR);
    expect(results).toHaveLength(0);
  });

  it("flags legacy openai-codex api transport", () => {
    writeModels({
      providers: {
        "openai-codex": { api: "openai-responses", baseUrl: "https://api.openai.com/v1" },
      },
    });
    const results = auditLegacyOverrides({} as OpenClawConfig, AGENT_DIR);
    const fail = results.find((r) => r.check === "Codex transport override");
    expect(fail).toBeDefined();
    expect(fail!.status).toBe("fail");
    expect(fail!.autoFixable).toBe(true);
  });

  it("passes when openai-codex has no legacy override", () => {
    writeModels({
      providers: { "openai-codex": {} },
    });
    const results = auditLegacyOverrides({} as OpenClawConfig, AGENT_DIR);
    const pass = results.find((r) => r.check === "Codex transport override");
    expect(pass!.status).toBe("pass");
  });

  it("warns on hardcoded sk- API keys", () => {
    writeModels({
      providers: {
        anthropic: { apiKey: "sk-ant-realkey1234567890abcdef" },
      },
    });
    const results = auditLegacyOverrides({} as OpenClawConfig, AGENT_DIR);
    expect(
      results.some((r) => r.check === "Hardcoded key: anthropic" && r.status === "warn")
    ).toBe(true);
  });

  it("does not flag SecretRef-style keys (__OP: prefix)", () => {
    writeModels({
      providers: {
        anthropic: { apiKey: "__OP:vault.kv.openai" },
      },
    });
    const results = auditLegacyOverrides({} as OpenClawConfig, AGENT_DIR);
    expect(results.some((r) => r.check.startsWith("Hardcoded key"))).toBe(false);
  });

  it("does not flag env-var placeholders", () => {
    writeModels({
      providers: {
        openrouter: { apiKey: "OPENROUTER_API_KEY" },
        anthropic: { apiKey: "ANTHROPIC_API_KEY" },
      },
    });
    const results = auditLegacyOverrides({} as OpenClawConfig, AGENT_DIR);
    expect(results.some((r) => r.check.startsWith("Hardcoded key"))).toBe(false);
  });

  it("treats allowPrivateNetwork on local providers as pass", () => {
    writeModels({
      providers: {
        ollama: { request: { allowPrivateNetwork: true } },
      },
    });
    const results = auditLegacyOverrides({} as OpenClawConfig, AGENT_DIR);
    const r = results.find((r) => r.check === "Private network: ollama");
    expect(r!.status).toBe("pass");
  });

  it("treats allowPrivateNetwork on remote providers as info", () => {
    writeModels({
      providers: {
        anthropic: { request: { allowPrivateNetwork: true } },
      },
    });
    const results = auditLegacyOverrides({} as OpenClawConfig, AGENT_DIR);
    const r = results.find((r) => r.check === "Private network: anthropic");
    expect(r!.status).toBe("info");
    expect(r!.message).toContain("intentional");
  });

  it("emits info on stale per-model api overrides", () => {
    writeModels({
      providers: {
        anthropic: {
          models: [{ id: "claude-old", api: "anthropic-completions" }],
        },
      },
    });
    const results = auditLegacyOverrides({} as OpenClawConfig, AGENT_DIR);
    expect(
      results.some(
        (r) =>
          r.check === "Model API override: anthropic/claude-old" && r.status === "info"
      )
    ).toBe(true);
  });

  it("does not flag canonical APIs (anthropic-messages, openai-codex-responses)", () => {
    writeModels({
      providers: {
        anthropic: {
          models: [{ id: "claude-opus-4-7", api: "anthropic-messages" }],
        },
        "openai-codex": {
          models: [{ id: "codex-1", api: "openai-codex-responses" }],
        },
      },
    });
    const results = auditLegacyOverrides({} as OpenClawConfig, AGENT_DIR);
    expect(results.some((r) => r.check.startsWith("Model API override"))).toBe(false);
  });
});
