import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenClawConfig, SandboxConfig } from "../src/types.js";

vi.mock("fs", () => ({ existsSync: vi.fn() }));
import { existsSync } from "fs";
import { auditSandboxBackends } from "../src/auditors/openclaw/sandbox-backends.js";

function agentSandbox(sandbox: SandboxConfig): OpenClawConfig {
  return { agents: { defaults: { sandbox } } } as OpenClawConfig;
}

describe("auditSandboxBackends", () => {
  beforeEach(() => vi.clearAllMocks());

  it("empty when no sandbox config", () => {
    expect(auditSandboxBackends({})).toHaveLength(0);
  });

  it("accepts bundled backends without findings", () => {
    for (const backend of ["docker", "ssh"]) {
      const results = auditSandboxBackends(agentSandbox({ backend }));
      expect(results.some(r => r.check.includes("Custom sandbox backend"))).toBe(false);
    }
  });

  it("reports custom backend names as info (plugins can register them)", () => {
    const results = auditSandboxBackends(agentSandbox({ backend: "openshell" }));
    const finding = results.find(r => r.check.includes("Custom sandbox backend"));
    expect(finding?.status).toBe("info");
    expect(finding?.message).toContain("docker");
  });

  it("warns when backend config still lives at legacy tools.sandbox", () => {
    const config: OpenClawConfig = {
      tools: { sandbox: { backend: "docker" } },
    };
    const results = auditSandboxBackends(config);
    expect(results.some(r => r.status === "warn" && r.check === "Legacy sandbox location")).toBe(true);
  });

  it("does not flag tools.sandbox that only carries a tool policy", () => {
    const config: OpenClawConfig = {
      tools: { sandbox: { tools: { deny: ["exec"] } } },
    };
    const results = auditSandboxBackends(config);
    expect(results.some(r => r.check === "Legacy sandbox location")).toBe(false);
  });

  it("flags missing SSH identityFile as fail", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const results = auditSandboxBackends(
      agentSandbox({ backend: "ssh", ssh: { target: "box", identityFile: "/missing/key" } })
    );
    expect(results.some(r => r.status === "fail" && r.check.includes("SSH identity"))).toBe(true);
  });

  it("warns when SSH certificateFile is specified but missing", () => {
    vi.mocked(existsSync).mockImplementation((p) => !String(p).includes("missing-cert"));
    const results = auditSandboxBackends(
      agentSandbox({ backend: "ssh", ssh: { target: "box", identityFile: "/key", certificateFile: "/missing-cert" } })
    );
    expect(results.some(r => r.status === "warn" && r.check.includes("SSH certificate"))).toBe(true);
  });

  it("warns when knownHostsFile is missing", () => {
    vi.mocked(existsSync).mockImplementation((p) => !String(p).includes("known_hosts"));
    const results = auditSandboxBackends(
      agentSandbox({ backend: "ssh", ssh: { target: "box", identityFile: "/key", knownHostsFile: "/missing/known_hosts" } })
    );
    expect(results.some(r => r.status === "warn" && r.check.includes("known_hosts"))).toBe(true);
  });

  it("warns when strictHostKeyChecking is disabled", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const results = auditSandboxBackends(
      agentSandbox({ backend: "ssh", ssh: { target: "box", identityFile: "/key", strictHostKeyChecking: false } })
    );
    expect(results.some(r => r.status === "warn" && r.check.includes("host key checking"))).toBe(true);
  });

  it("passes when SSH files exist and host key checking is on", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const results = auditSandboxBackends(
      agentSandbox({ backend: "ssh", ssh: { target: "box", identityFile: "/key", knownHostsFile: "/kh" } })
    );
    expect(results.every(r => r.status !== "fail" && r.status !== "warn")).toBe(true);
  });

  it("audits per-agent sandbox blocks too", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const config = {
      agents: {
        list: [
          { id: "worker", sandbox: { backend: "ssh", ssh: { identityFile: "/missing" } } },
        ],
      },
    } as OpenClawConfig;
    const results = auditSandboxBackends(config);
    expect(results.some(r => r.status === "fail" && r.check.includes('agent "worker"'))).toBe(true);
  });
});
