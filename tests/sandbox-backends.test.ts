import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenClawConfig } from "../src/types.js";

vi.mock("fs", () => ({ existsSync: vi.fn() }));
import { existsSync } from "fs";
import { auditSandboxBackends } from "../src/auditors/openclaw/sandbox-backends.js";

describe("auditSandboxBackends", () => {
  beforeEach(() => vi.clearAllMocks());

  it("empty when no sandbox config", () => {
    expect(auditSandboxBackends({})).toHaveLength(0);
  });

  it("warns on unknown backend name", () => {
    const config: OpenClawConfig = {
      tools: { sandbox: { backend: "weird-backend" } },
    };
    const results = auditSandboxBackends(config);
    expect(results.some(r => r.status === "warn" && r.check.includes("Unknown sandbox backend"))).toBe(true);
  });

  it("accepts known backend names without warning", () => {
    for (const backend of ["openshell", "ssh", "none", "off"]) {
      const config: OpenClawConfig = { tools: { sandbox: { backend } } };
      const results = auditSandboxBackends(config);
      expect(results.some(r => r.check.includes("Unknown sandbox backend"))).toBe(false);
    }
  });

  it("flags missing SSH key path as fail", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const config: OpenClawConfig = {
      tools: { sandbox: { backend: "ssh", ssh: { host: "box", keyPath: "/missing/key" } } },
    };
    const results = auditSandboxBackends(config);
    expect(results.some(r => r.status === "fail" && r.check.includes("SSH key"))).toBe(true);
  });

  it("warns when SSH cert is specified but missing", () => {
    vi.mocked(existsSync).mockImplementation((p) => !String(p).includes("missing-cert"));
    const config: OpenClawConfig = {
      tools: { sandbox: { backend: "ssh", ssh: { host: "box", keyPath: "/key", certPath: "/missing-cert" } } },
    };
    const results = auditSandboxBackends(config);
    expect(results.some(r => r.status === "warn" && r.check.includes("SSH cert"))).toBe(true);
  });

  it("warns when known_hosts is missing", () => {
    vi.mocked(existsSync).mockImplementation((p) => !String(p).includes("known_hosts"));
    const config: OpenClawConfig = {
      tools: { sandbox: { backend: "ssh", ssh: { host: "box", keyPath: "/key", knownHostsPath: "/missing/known_hosts" } } },
    };
    const results = auditSandboxBackends(config);
    expect(results.some(r => r.status === "warn" && r.check.includes("known_hosts"))).toBe(true);
  });

  it("warns when known_hosts is not configured at all on ssh backend", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const config: OpenClawConfig = {
      tools: { sandbox: { backend: "ssh", ssh: { host: "box", keyPath: "/key" } } },
    };
    const results = auditSandboxBackends(config);
    expect(results.some(r => r.status === "warn" && r.check.includes("known_hosts"))).toBe(true);
  });

  it("passes when all SSH files exist and known_hosts configured", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const config: OpenClawConfig = {
      tools: { sandbox: { backend: "ssh", ssh: { host: "box", keyPath: "/key", knownHostsPath: "/kh" } } },
    };
    const results = auditSandboxBackends(config);
    expect(results.every(r => r.status !== "fail")).toBe(true);
    expect(results.some(r => r.check.includes("known_hosts"))).toBe(false);
  });
});
