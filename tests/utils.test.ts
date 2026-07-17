import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import {
  parseInterval,
  parseVersion,
  isOlderThan,
  findAgentDir,
  findWorkspace,
  loadConfig,
  getConfigLoadIssues,
} from "../src/utils/config.js";
import type { OpenClawConfig } from "../src/types.js";

describe("findAgentDir / findWorkspace — malformed list robustness", () => {
  it("falls back to defaults when the first list element is null", () => {
    const config = { agents: { list: [null, { agentDir: "/d", workspace: "/w" }] } } as unknown as OpenClawConfig;
    expect(() => findAgentDir(config)).not.toThrow();
    expect(findAgentDir(config)).toBe("~/.openclaw/agents/main/agent");
    expect(findWorkspace(config)).toBe("~/.openclaw/workspace");
  });

  it("does not crash when agents.list is not an array", () => {
    const config = { agents: { list: { foo: "bar" } } } as unknown as OpenClawConfig;
    expect(() => findAgentDir(config)).not.toThrow();
    expect(() => findWorkspace(config)).not.toThrow();
  });

  it("still reads a valid first entry", () => {
    const config = { agents: { list: [{ agentDir: "/custom/dir", workspace: "/custom/ws" }] } } as unknown as OpenClawConfig;
    expect(findAgentDir(config)).toBe("/custom/dir");
    expect(findWorkspace(config)).toBe("/custom/ws");
  });
});

describe("parseInterval", () => {
  it("parses seconds", () => {
    expect(parseInterval("30s")).toBe(30);
  });

  it("parses minutes", () => {
    expect(parseInterval("5m")).toBe(300);
  });

  it("parses hours", () => {
    expect(parseInterval("6h")).toBe(21600);
  });

  it("parses days", () => {
    expect(parseInterval("1d")).toBe(86400);
  });

  it("returns 0 for invalid format", () => {
    expect(parseInterval("invalid")).toBe(0);
    expect(parseInterval("")).toBe(0);
    expect(parseInterval("10")).toBe(0);
  });
});

describe("parseVersion", () => {
  it("parses standard version", () => {
    expect(parseVersion("2026.4.14")).toEqual({ year: 2026, major: 4, patch: 14 });
  });

  it("parses version with beta suffix", () => {
    expect(parseVersion("2026.4.15-beta.1")).toEqual({ year: 2026, major: 4, patch: 15 });
  });

  it("returns null for invalid versions", () => {
    expect(parseVersion("invalid")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("isOlderThan", () => {
  it("detects older patch versions", () => {
    expect(isOlderThan("2026.4.12", "2026.4.14")).toBe(true);
  });

  it("detects same version is not older", () => {
    expect(isOlderThan("2026.4.14", "2026.4.14")).toBe(false);
  });

  it("detects newer version is not older", () => {
    expect(isOlderThan("2026.4.15", "2026.4.14")).toBe(false);
  });

  it("compares across major versions", () => {
    expect(isOlderThan("2026.2.25", "2026.4.14")).toBe(true);
  });

  it("compares across years", () => {
    expect(isOlderThan("2025.12.30", "2026.1.1")).toBe(true);
  });

  it("returns false for invalid versions", () => {
    expect(isOlderThan("invalid", "2026.4.14")).toBe(false);
  });
});

describe("loadConfig — JSON5 + $include", () => {
  const DIR = join(process.cwd(), "__test_config_load__");
  const CFG = join(DIR, "openclaw.json");

  const setup = () => {
    if (existsSync(DIR)) rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
  };
  const teardown = () => {
    if (existsSync(DIR)) rmSync(DIR, { recursive: true, force: true });
  };

  it("parses JSON5 configs (comments, trailing commas, unquoted keys)", () => {
    setup();
    writeFileSync(CFG, `{
      // primary model
      agents: {
        defaults: { model: { primary: "anthropic/claude-opus-4-8", }, },
      },
    }`);
    const config = loadConfig(CFG);
    expect(config?.agents?.defaults?.model?.primary).toBe("anthropic/claude-opus-4-8");
    teardown();
  });

  it("resolves a single $include and lets sibling keys win", () => {
    setup();
    writeFileSync(join(DIR, "base.json5"), `{ agents: { defaults: { contextTokens: 100000, thinkingDefault: "low" } } }`);
    writeFileSync(CFG, JSON.stringify({
      "$include": "./base.json5",
      agents: { defaults: { thinkingDefault: "high" } },
    }));
    const config = loadConfig(CFG);
    expect(config?.agents?.defaults?.contextTokens).toBe(100000);
    expect(config?.agents?.defaults?.thinkingDefault).toBe("high");
    expect(getConfigLoadIssues()).toHaveLength(0);
    teardown();
  });

  it("merges $include arrays left-to-right", () => {
    setup();
    writeFileSync(join(DIR, "a.json"), JSON.stringify({ gateway: { port: 1111 }, channels: { telegram: {} } }));
    writeFileSync(join(DIR, "b.json"), JSON.stringify({ gateway: { port: 2222 } }));
    writeFileSync(CFG, JSON.stringify({ "$include": ["./a.json", "./b.json"] }));
    const config = loadConfig(CFG);
    expect((config?.gateway as { port?: number })?.port).toBe(2222);
    expect(config?.channels).toBeDefined();
    teardown();
  });

  it("resolves nested $include relative to the including file", () => {
    setup();
    mkdirSync(join(DIR, "sub"));
    writeFileSync(join(DIR, "sub", "inner.json"), JSON.stringify({ contextTokens: 42000 }));
    writeFileSync(join(DIR, "sub", "outer.json"), JSON.stringify({ defaults: { "$include": "./inner.json" } }));
    writeFileSync(CFG, JSON.stringify({ agents: { "$include": "./sub/outer.json" } }));
    const config = loadConfig(CFG);
    expect(config?.agents?.defaults?.contextTokens).toBe(42000);
    teardown();
  });

  it("records an issue instead of crashing on a missing include", () => {
    setup();
    writeFileSync(CFG, JSON.stringify({ "$include": "./nope.json", agents: {} }));
    const config = loadConfig(CFG);
    expect(config).not.toBeNull();
    expect(getConfigLoadIssues().some((i) => i.includes("not found"))).toBe(true);
    teardown();
  });

  it("records an issue on circular includes", () => {
    setup();
    writeFileSync(join(DIR, "x.json"), JSON.stringify({ "$include": "./y.json" }));
    writeFileSync(join(DIR, "y.json"), JSON.stringify({ "$include": "./x.json" }));
    writeFileSync(CFG, JSON.stringify({ "$include": "./x.json" }));
    const config = loadConfig(CFG);
    expect(config).not.toBeNull();
    expect(getConfigLoadIssues().some((i) => i.includes("Circular"))).toBe(true);
    teardown();
  });
});
