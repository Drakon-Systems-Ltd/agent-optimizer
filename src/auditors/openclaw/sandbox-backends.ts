import { existsSync } from "fs";
import type { AuditResult, OpenClawConfig } from "../../types.js";
import { expandPath } from "../../utils/config.js";

const KNOWN_BACKENDS = ["openshell", "ssh", "none", "off"];

export function auditSandboxBackends(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];
  const sandbox = config.tools?.sandbox;
  if (!sandbox) return results;

  if (sandbox.backend && !KNOWN_BACKENDS.includes(sandbox.backend)) {
    results.push({
      category: "Sandbox",
      check: "Unknown sandbox backend",
      status: "warn",
      message: `tools.sandbox.backend="${sandbox.backend}" is not a recognised backend`,
      fix: `Use one of: ${KNOWN_BACKENDS.join(", ")}`,
    });
  }

  if (sandbox.backend === "ssh" && sandbox.ssh) {
    const { keyPath, certPath, knownHostsPath } = sandbox.ssh;

    if (keyPath && !existsSync(expandPath(keyPath))) {
      results.push({
        category: "Sandbox",
        check: "SSH key missing",
        status: "fail",
        message: `SSH key path "${keyPath}" does not exist — sandbox will fail to connect`,
        fix: "Generate a key with ssh-keygen or correct the path",
      });
    }

    if (certPath && !existsSync(expandPath(certPath))) {
      results.push({
        category: "Sandbox",
        check: "SSH cert missing",
        status: "warn",
        message: `SSH cert path "${certPath}" does not exist`,
      });
    }

    if (!knownHostsPath || !existsSync(expandPath(knownHostsPath))) {
      results.push({
        category: "Sandbox",
        check: "SSH known_hosts missing",
        status: "warn",
        message: "known_hosts file not configured or missing — SSH sandbox will accept unknown hosts",
        fix: "Set tools.sandbox.ssh.knownHostsPath to a populated known_hosts file",
      });
    }
  }

  return results;
}
