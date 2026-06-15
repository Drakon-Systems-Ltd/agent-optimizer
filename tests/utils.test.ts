import { describe, it, expect } from "vitest";
import { parseInterval, parseVersion, isOlderThan, findAgentDir, findWorkspace } from "../src/utils/config.js";
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
