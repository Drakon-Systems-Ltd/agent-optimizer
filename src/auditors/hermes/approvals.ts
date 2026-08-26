import type { AuditResult } from "../../types.js";
import { section, type HermesConfig } from "./types.js";

// Standalone allowlist entries that grant a whole shell — with any of these the
// allowlist gates nothing, because arbitrary commands run through the shell.
const BLANKET_SHELL_ENTRIES = new Set(["bash", "sh", "zsh", "dash", "*"]);

export function auditHermesApprovals(config: HermesConfig): AuditResult[] {
  const results: AuditResult[] = [];

  const approvals = section(config, "approvals");
  if (approvals) {
    const mode = approvals["mode"];
    if (typeof mode === "string" && mode.trim() !== "") {
      if (["off", "never"].includes(mode.trim().toLowerCase())) {
        results.push({
          category: "Hermes Approvals",
          check: "Approval mode",
          status: "warn",
          message: `Approval mode is "${mode}" — the agent executes commands without human sign-off`,
          fix: "Set approvals.mode to an approval-gated mode in ~/.hermes/config.yaml",
        });
      } else {
        results.push({
          category: "Hermes Approvals",
          check: "Approval mode",
          status: "info",
          message: `Approval mode: ${mode}`,
        });
      }
    } else {
      results.push({
        category: "Hermes Approvals",
        check: "Approval mode",
        status: "info",
        message: "approvals.mode not set — Hermes default applies",
      });
    }
  }

  const allowlist = config?.["command_allowlist"];
  if (Array.isArray(allowlist)) {
    results.push({
      category: "Hermes Approvals",
      check: "Command allowlist",
      status: "info",
      message: `command_allowlist: ${allowlist.length} entr${allowlist.length === 1 ? "y" : "ies"}`,
    });

    const blanket = allowlist.filter(
      (e): e is string => typeof e === "string" && BLANKET_SHELL_ENTRIES.has(e.trim())
    );
    if (blanket.length > 0) {
      results.push({
        category: "Hermes Approvals",
        check: "Blanket shell in allowlist",
        status: "warn",
        message: `command_allowlist contains blanket shell entr${blanket.length === 1 ? "y" : "ies"}: ${blanket.join(", ")} — allowlisting a bare shell makes the allowlist meaningless`,
        fix: "Replace bare shell entries with the specific commands the agent needs",
      });
    }
  }
  // String-valued allowlist: config-shape.ts emits the stored-as-string FAIL.

  return results;
}
