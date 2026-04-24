import type { AuditResult } from "../types.js";
import { isOlderThan } from "../utils/config.js";

interface SecurityAdvisory {
  fixedIn: string;
  severity: "fail" | "warn";
  check: string;
  message: string;
  fix: string;
}

// Known security issues fixed in specific OpenClaw versions.
// Each advisory is shown if the detected version is older than fixedIn.
const ADVISORIES: SecurityAdvisory[] = [
  // v2026.4.14 fixes
  {
    fixedIn: "2026.4.14",
    severity: "fail",
    check: "config.patch gateway bypass",
    message: "config.patch and config.apply callable from gateway tool even with security flags enabled — allows remote config modification",
    fix: "Upgrade to OpenClaw v2026.4.14+",
  },
  {
    fixedIn: "2026.4.14",
    severity: "warn",
    check: "Browser SSRF enforcement",
    message: "Browser snapshot, screenshot, and tab routes don't enforce SSRF policy — internal network resources may be accessible",
    fix: "Upgrade to OpenClaw v2026.4.14+",
  },
  {
    fixedIn: "2026.4.14",
    severity: "warn",
    check: "Config snapshot redaction",
    message: "sourceConfig and runtimeConfig alias fields not redacted in config snapshots — may expose sensitive values",
    fix: "Upgrade to OpenClaw v2026.4.14+",
  },
  {
    fixedIn: "2026.4.14",
    severity: "warn",
    check: "Attachment path traversal",
    message: "Local attachment paths not canonically resolved — potential path traversal when resolving file attachments",
    fix: "Upgrade to OpenClaw v2026.4.14+",
  },
  {
    fixedIn: "2026.4.14",
    severity: "warn",
    check: "Control UI ReDoS",
    message: "marked.js in Control UI vulnerable to ReDoS — malformed markdown can freeze the interface",
    fix: "Upgrade to OpenClaw v2026.4.14+ (switched to markdown-it)",
  },
  {
    fixedIn: "2026.4.14",
    severity: "warn",
    check: "Slack event allowlist",
    message: "Slack channel block-action and modal interactive events not checked against allowFrom owner allowlist",
    fix: "Upgrade to OpenClaw v2026.4.14+",
  },
  {
    fixedIn: "2026.4.14",
    severity: "warn",
    check: "hook:wake trust level",
    message: "Untrusted hook:wake system events not downgraded to owner level — may execute with elevated permissions",
    fix: "Upgrade to OpenClaw v2026.4.14+",
  },
  // v2026.4.15 fixes
  {
    fixedIn: "2026.4.15",
    severity: "fail",
    check: "Approval prompt secret leak",
    message: "Secrets visible in exec approval prompts — inline approval review can leak credential material",
    fix: "Upgrade to OpenClaw v2026.4.15+",
  },
  {
    fixedIn: "2026.4.15",
    severity: "fail",
    check: "Workspace symlink traversal",
    message: "agents.files.get/set and workspace listing don't prevent symlink-swap attacks — can read/write outside workspace",
    fix: "Upgrade to OpenClaw v2026.4.15+",
  },
  {
    fixedIn: "2026.4.15",
    severity: "warn",
    check: "Bearer timing attack",
    message: "Gateway /mcp bearer comparison uses plain !== instead of constant-time comparison — vulnerable to timing attacks",
    fix: "Upgrade to OpenClaw v2026.4.15+",
  },
  {
    fixedIn: "2026.4.15",
    severity: "warn",
    check: "Memory path traversal",
    message: "QMD memory-core backend allows reads of arbitrary workspace markdown paths — not limited to canonical memory files",
    fix: "Upgrade to OpenClaw v2026.4.15+",
  },
  {
    fixedIn: "2026.4.15",
    severity: "warn",
    check: "Feishu webhook auth",
    message: "Feishu webhook transport starts without encryptKey — accepts unauthenticated webhook payloads",
    fix: "Upgrade to OpenClaw v2026.4.15+",
  },
  // v2026.4.23 fixes
  {
    fixedIn: "2026.4.23",
    severity: "warn",
    check: "config.patch allowlist lockdown",
    message: "Gateway config.patch/config.apply runtime edits rely on a hand-maintained denylist — agents can mutate sensitive keys the denylist missed. Fixed in 2026.4.23 by allowlisting a narrow set of agent-tunable paths (prompt, model, mention-gating) and failing closed on everything else.",
    fix: "Upgrade to OpenClaw v2026.4.23+. After upgrade, audit agent cron/hooks for config.patch usage — non-allowlisted mutations now silently fail.",
  },
  // v2026.4.12 fixes
  {
    fixedIn: "2026.4.12",
    severity: "warn",
    check: "Empty approver bypass",
    message: "Empty approver list grants explicit approval authorization — any user can approve elevated actions",
    fix: "Upgrade to OpenClaw v2026.4.12+",
  },
  {
    fixedIn: "2026.4.12",
    severity: "warn",
    check: "Shell wrapper detection",
    message: "Incomplete shell-wrapper detection allows env-argv assignment injection via interpreter-like safe bins",
    fix: "Upgrade to OpenClaw v2026.4.12+",
  },
];

export function auditSecurityAdvisories(openclawVersion: string): AuditResult[] {
  const results: AuditResult[] = [];

  if (openclawVersion === "unknown") {
    results.push({
      category: "Security",
      check: "OpenClaw version",
      status: "info",
      message: "Could not detect OpenClaw version — security advisory checks skipped",
      fix: "Ensure openclaw is installed and in PATH, or run the audit on the host",
    });
    return results;
  }

  results.push({
    category: "Security",
    check: "OpenClaw version",
    status: "pass",
    message: `Detected OpenClaw ${openclawVersion}`,
  });

  // Check each advisory
  const applicable = ADVISORIES.filter((a) => isOlderThan(openclawVersion, a.fixedIn));

  if (applicable.length === 0) {
    results.push({
      category: "Security",
      check: "Security advisories",
      status: "pass",
      message: "No known security advisories for this version",
    });
    return results;
  }

  const critical = applicable.filter((a) => a.severity === "fail");
  const warnings = applicable.filter((a) => a.severity === "warn");

  for (const advisory of applicable) {
    results.push({
      category: "Security",
      check: advisory.check,
      status: advisory.severity,
      message: advisory.message,
      fix: advisory.fix,
    });
  }

  // Summary
  const latestFix = applicable.reduce((max, a) =>
    isOlderThan(max, a.fixedIn) ? a.fixedIn : max, applicable[0].fixedIn);

  results.push({
    category: "Security",
    check: "Advisory summary",
    status: critical.length > 0 ? "fail" : "warn",
    message: `${applicable.length} security advisories (${critical.length} critical, ${warnings.length} warnings) — upgrade to v${latestFix}+ to resolve all`,
    fix: `Run: npm install -g openclaw@latest`,
  });

  return results;
}
