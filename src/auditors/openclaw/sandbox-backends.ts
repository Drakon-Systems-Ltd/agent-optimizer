import { existsSync } from "fs";
import type { AuditResult, OpenClawConfig, SandboxConfig } from "../../types.js";
import { expandPath } from "../../utils/config.js";

// Bundled backends in OpenClaw 2026.7.1 (src/agents/sandbox/backend.ts).
// The config field is a free string — plugins can register custom backends —
// so unknown values are informational, not errors.
const BUNDLED_BACKENDS = ["docker", "ssh"];

export function auditSandboxBackends(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];

  // Sandbox backend/ssh config moved from tools.sandbox to agent-level
  // sandbox (agents.defaults.sandbox / agents.list[].sandbox). Flag configs
  // still carrying backend config in the legacy location.
  const legacySandbox = config.tools?.sandbox;
  if (legacySandbox && (legacySandbox.backend || legacySandbox.mode || legacySandbox.ssh)) {
    results.push({
      category: "Sandbox",
      check: "Legacy sandbox location",
      status: "warn",
      message:
        "tools.sandbox carries backend/mode/ssh config — OpenClaw now reads sandbox config from agents.defaults.sandbox (tools.sandbox only holds a tool policy)",
      fix: "Move backend/mode/ssh settings to agents.defaults.sandbox",
    });
  }

  const targets: Array<{ label: string; sandbox: SandboxConfig }> = [];
  const defaults = config.agents?.defaults?.sandbox;
  if (defaults && typeof defaults === "object") {
    targets.push({ label: "agents.defaults", sandbox: defaults });
  }
  if (Array.isArray(config.agents?.list)) {
    for (const agent of config.agents.list) {
      if (agent && typeof agent === "object" && agent.sandbox && typeof agent.sandbox === "object") {
        targets.push({ label: `agent "${agent.id ?? "?"}"`, sandbox: agent.sandbox });
      }
    }
  }

  for (const { label, sandbox } of targets) {
    if (sandbox.backend && !BUNDLED_BACKENDS.includes(sandbox.backend)) {
      results.push({
        category: "Sandbox",
        check: `Custom sandbox backend (${label})`,
        status: "info",
        message: `sandbox.backend="${sandbox.backend}" is not a bundled backend (docker, ssh) — fine if a plugin registers it, otherwise the sandbox will fail to start`,
        fix: `Use a bundled backend (${BUNDLED_BACKENDS.join(", ")}) or ensure the providing plugin is enabled`,
      });
    }

    if (sandbox.backend === "ssh" && sandbox.ssh) {
      const { identityFile, certificateFile, knownHostsFile, strictHostKeyChecking } = sandbox.ssh;

      if (identityFile && !existsSync(expandPath(identityFile))) {
        results.push({
          category: "Sandbox",
          check: `SSH identity missing (${label})`,
          status: "fail",
          message: `SSH identityFile "${identityFile}" does not exist — sandbox will fail to connect`,
          fix: "Generate a key with ssh-keygen or correct the path",
        });
      }

      if (certificateFile && !existsSync(expandPath(certificateFile))) {
        results.push({
          category: "Sandbox",
          check: `SSH certificate missing (${label})`,
          status: "warn",
          message: `SSH certificateFile "${certificateFile}" does not exist`,
        });
      }

      if (knownHostsFile && !existsSync(expandPath(knownHostsFile))) {
        results.push({
          category: "Sandbox",
          check: `SSH known_hosts missing (${label})`,
          status: "warn",
          message: `SSH knownHostsFile "${knownHostsFile}" does not exist`,
          fix: "Point sandbox.ssh.knownHostsFile at a populated known_hosts file",
        });
      }

      if (strictHostKeyChecking === false) {
        results.push({
          category: "Sandbox",
          check: `SSH host key checking (${label})`,
          status: "warn",
          message: "strictHostKeyChecking is disabled — SSH sandbox will accept unknown hosts (MITM risk)",
          fix: "Remove strictHostKeyChecking: false and provision known_hosts instead",
        });
      }
    }
  }

  return results;
}
