import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from "fs";
import { auditMcpServers } from "../src/auditors/claude-code/mcp-servers.js";

describe("auditMcpServers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty when path is null", () => {
    expect(auditMcpServers(null)).toHaveLength(0);
  });

  it("returns empty when file does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(auditMcpServers("/missing/.claude.json")).toHaveLength(0);
  });

  it("warns when file exists but is invalid JSON", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("not valid json{");
    const results = auditMcpServers("/fake/.claude.json");
    expect(results.some(r => r.status === "warn" && r.check.toLowerCase().includes("readable"))).toBe(true);
  });

  it("info when mcpServers is empty", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ mcpServers: {} }));
    const results = auditMcpServers("/fake/.claude.json");
    expect(results.some(r => r.status === "info" && r.check.toLowerCase().includes("count"))).toBe(true);
  });

  it("warns when more than 10 servers configured", () => {
    const servers: Record<string, unknown> = {};
    for (let i = 0; i < 12; i++) {
      servers[`srv${i}`] = { type: "stdio", command: "echo" };
    }
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ mcpServers: servers }));
    const results = auditMcpServers("/fake/.claude.json");
    expect(results.some(r => r.status === "warn" && r.check.toLowerCase().includes("count"))).toBe(true);
  });

  it("fails when more than 25 servers configured", () => {
    const servers: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) {
      servers[`srv${i}`] = { type: "stdio", command: "echo" };
    }
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ mcpServers: servers }));
    const results = auditMcpServers("/fake/.claude.json");
    expect(results.some(r => r.status === "fail" && r.check.toLowerCase().includes("count"))).toBe(true);
  });

  it("warns when a server is missing type field", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: { broken: { command: "echo" } },
    }));
    const results = auditMcpServers("/fake/.claude.json");
    expect(results.some(r => r.status === "warn" && r.check.toLowerCase().includes("type"))).toBe(true);
  });

  it("fails when a stdio server has no command", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: { stdiosrv: { type: "stdio" } },
    }));
    const results = auditMcpServers("/fake/.claude.json");
    expect(results.some(r => r.status === "fail" && r.check.toLowerCase().includes("command"))).toBe(true);
  });

  it("fails when an http server has no url", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: { httpsrv: { type: "http" } },
    }));
    const results = auditMcpServers("/fake/.claude.json");
    expect(results.some(r => r.status === "fail" && r.check.toLowerCase().includes("url"))).toBe(true);
  });

  it("fails on unknown server type", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: { weird: { type: "carrier-pigeon", command: "fly" } },
    }));
    const results = auditMcpServers("/fake/.claude.json");
    expect(results.some(r => r.status === "fail" && r.check.toLowerCase().includes("unknown server type"))).toBe(true);
  });

  it("info when env block is empty object", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: { srv: { type: "stdio", command: "echo", env: {} } },
    }));
    const results = auditMcpServers("/fake/.claude.json");
    expect(results.some(r => r.status === "info" && r.check.toLowerCase().includes("env"))).toBe(true);
  });

  it("clean stdio + http config produces no fails", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: {
        a: { type: "stdio", command: "node", args: ["server.js"], env: { TOKEN: "x" } },
        b: { type: "http", url: "https://example.com/mcp" },
      },
    }));
    const results = auditMcpServers("/fake/.claude.json");
    expect(results.every(r => r.status !== "fail")).toBe(true);
  });
});
