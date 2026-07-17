import type { AuditResult } from "../../types.js";
import { isOlderThan } from "../../utils/config.js";

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
  // v2026.4.24 fixes
  {
    fixedIn: "2026.4.24",
    severity: "fail",
    check: "registerEmbeddedExtensionFactory removed",
    message: "Plugins using api.registerEmbeddedExtensionFactory() will silently fail to load on v2026.4.24+. The Pi-only embedded-extension compatibility path was removed in favor of api.registerAgentToolResultMiddleware(), which targets the harness explicitly.",
    fix: "Grep your plugin source for `registerEmbeddedExtensionFactory` and replace with `registerAgentToolResultMiddleware`, supplying the appropriate target harness. See OpenClaw v2026.4.24 release notes for the migration shape.",
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
  // v2026.5.19 fixes
  {
    fixedIn: "2026.5.19",
    severity: "fail",
    check: "Control UI token disclosure",
    message: "Unauthenticated Control UI bootstrap responses include gateway bearer tokens — anyone who can reach the UI port can obtain gateway auth",
    fix: "Upgrade to OpenClaw v2026.5.19+",
  },
  {
    fixedIn: "2026.5.19",
    severity: "warn",
    check: "Inline skill policy bypass",
    message: "Inline skill dispatch skips the full tool-policy pipeline — skills can invoke tools the agent's policy would deny",
    fix: "Upgrade to OpenClaw v2026.5.19+",
  },
  {
    fixedIn: "2026.5.19",
    severity: "warn",
    check: "Browser URL allowlist gaps",
    message: "Browser /act and /highlight routes don't enforce the URL allowlist — agents can drive the browser to non-allowlisted origins",
    fix: "Upgrade to OpenClaw v2026.5.19+",
  },
  // v2026.5.20 fixes
  {
    fixedIn: "2026.5.20",
    severity: "fail",
    check: "Symlinked credential reads",
    message: "Credential file reads don't fail closed on symlinks — a symlink swapped into a credential path can exfiltrate arbitrary files",
    fix: "Upgrade to OpenClaw v2026.5.20+",
  },
  // v2026.5.22 fixes
  {
    fixedIn: "2026.5.22",
    severity: "fail",
    check: "Gateway token persistence leaks",
    message: "OPENCLAW_GATEWAY_TOKEN written into systemd unit files and printed by Docker setup — gateway credentials land in world-readable state",
    fix: "Upgrade to OpenClaw v2026.5.22+",
  },
  {
    fixedIn: "2026.5.22",
    severity: "warn",
    check: "Denied-exec log leakage",
    message: "Denied exec attempts logged with raw command line and environment — secrets in rejected commands persist in logs",
    fix: "Upgrade to OpenClaw v2026.5.22+",
  },
  {
    fixedIn: "2026.5.22",
    severity: "warn",
    check: "Control UI diffs XSS",
    message: "Diffs viewer toolbar icon is an XSS sink — crafted diff content can execute script in the Control UI",
    fix: "Upgrade to OpenClaw v2026.5.22+",
  },
  {
    fixedIn: "2026.5.22",
    severity: "warn",
    check: "Agent XDG env override",
    message: "Agent-supplied XDG environment overrides accepted — agents can redirect state/config directories",
    fix: "Upgrade to OpenClaw v2026.5.22+",
  },
  // v2026.5.26 fixes
  {
    fixedIn: "2026.5.26",
    severity: "fail",
    check: "Gateway auth rate limiting",
    message: "No default rate limit on gateway auth attempts when gateway.auth.rateLimit is unset — password/token brute-force is unthrottled",
    fix: "Upgrade to OpenClaw v2026.5.26+ (rate limiter now on by default)",
  },
  {
    fixedIn: "2026.5.26",
    severity: "warn",
    check: "memory_store prompt injection",
    message: "memory_store accepts unfiltered content — prompt-injection payloads can persist into memory and replay into future turns",
    fix: "Upgrade to OpenClaw v2026.5.26+",
  },
  {
    fixedIn: "2026.5.26",
    severity: "warn",
    check: "Browser tab SSRF",
    message: "Browser snapshot doesn't apply SSRF policy to tab URLs — internal endpoints reachable via agent-driven tabs",
    fix: "Upgrade to OpenClaw v2026.5.26+",
  },
  {
    fixedIn: "2026.5.26",
    severity: "warn",
    check: "Prompt marker spoofing",
    message: "System-event text can spoof prompt boundary markers — untrusted content can masquerade as system instructions",
    fix: "Upgrade to OpenClaw v2026.5.26+",
  },
  // v2026.5.27 fixes
  {
    fixedIn: "2026.5.27",
    severity: "fail",
    check: "No-auth Tailscale exposure",
    message: "Gateway with auth disabled can be exposed over Tailscale serve/funnel — remote access with no authentication",
    fix: "Upgrade to OpenClaw v2026.5.27+ (now rejected at startup)",
  },
  {
    fixedIn: "2026.5.27",
    severity: "warn",
    check: "Device pairing approval",
    message: "Node device-role pairing doesn't require admin approval — devices can self-enroll with node privileges",
    fix: "Upgrade to OpenClaw v2026.5.27+",
  },
  // v2026.5.28 fixes
  {
    fixedIn: "2026.5.28",
    severity: "warn",
    check: "Phone-control authorization",
    message: "Phone-control mutations not authorization-checked — non-owner senders could trigger device actions",
    fix: "Upgrade to OpenClaw v2026.5.28+",
  },
  // v2026.6.6 fixes
  {
    fixedIn: "2026.6.6",
    severity: "fail",
    check: "Fail-open trust boundaries",
    message: "Transcript, sandbox, MCP, browser, channel, and exec-approval boundaries fail open on errors; unauthorized Telegram DM text reaches cache/prompt",
    fix: "Upgrade to OpenClaw v2026.6.6+ (boundaries now fail closed)",
  },
  // v2026.6.8 fixes
  {
    fixedIn: "2026.6.8",
    severity: "warn",
    check: "HTTP override admin gate",
    message: "HTTP session and model override surfaces don't require admin — non-admin callers can redirect sessions to other models",
    fix: "Upgrade to OpenClaw v2026.6.8+",
  },
  {
    fixedIn: "2026.6.8",
    severity: "warn",
    check: "Vulnerable Hono runtime",
    message: "Bundled Hono HTTP framework older than 4.12.25 has known vulnerabilities",
    fix: "Upgrade to OpenClaw v2026.6.8+",
  },
  // v2026.6.9 fixes
  {
    fixedIn: "2026.6.9",
    severity: "fail",
    check: "Secrets in debug output",
    message: "Debug and config output don't redact secrets — API keys and tokens appear in diagnostics and shared debug dumps",
    fix: "Upgrade to OpenClaw v2026.6.9+",
  },
  // v2026.6.11 fixes
  {
    fixedIn: "2026.6.11",
    severity: "fail",
    check: "DOMPurify XSS (GHSA-cmwh-pvxp-8882)",
    message: "Bundled DOMPurify vulnerable to GHSA-cmwh-pvxp-8882 — sanitizer bypass enables XSS in rendered agent content",
    fix: "Upgrade to OpenClaw v2026.6.11+",
  },
  {
    fixedIn: "2026.6.11",
    severity: "warn",
    check: "Blank TLS cert/key accepted",
    message: "Gateway TLS accepts blank certificate/key paths — TLS silently misconfigured instead of rejected",
    fix: "Upgrade to OpenClaw v2026.6.11+",
  },
  // v2026.7.1 fixes
  {
    fixedIn: "2026.7.1",
    severity: "fail",
    check: "SecretRef process exposure",
    message: "Provider secrets resolved from SecretRefs held in plain process memory instead of behind process-local sentinels — plugins and logs can observe raw secrets",
    fix: "Upgrade to OpenClaw v2026.7.1+",
  },
  {
    fixedIn: "2026.7.1",
    severity: "fail",
    check: "SQLite WAL safety",
    message: "State databases opened without verifying the runtime's SQLite is patched — WAL corruption can destroy session/auth/memory state",
    fix: "Upgrade to OpenClaw v2026.7.1+ and use Node 22/24 (Node 23 is rejected)",
  },
  {
    fixedIn: "2026.7.1",
    severity: "warn",
    check: "Telegram token in logs",
    message: "Telegram bot tokens not redacted across chunked log transports — tokens leak into shipped logs",
    fix: "Upgrade to OpenClaw v2026.7.1+",
  },
  {
    fixedIn: "2026.7.1",
    severity: "warn",
    check: "MCP/Teams response bounds",
    message: "MCP OAuth and MS Teams Graph/Bot Framework responses not size-bounded — oversized responses can exhaust memory",
    fix: "Upgrade to OpenClaw v2026.7.1+",
  },
];

// Newest OpenClaw release this advisory table covers. Bump when refreshing the
// table — the version-currency checks below key off it.
export const ADVISORY_TABLE_CURRENT = "2026.7.1";

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

  // Detected version is newer than the advisory table — be honest that our
  // data may be behind rather than implying a clean bill of health.
  if (isOlderThan(ADVISORY_TABLE_CURRENT, openclawVersion)) {
    results.push({
      category: "Security",
      check: "Advisory data currency",
      status: "info",
      message: `OpenClaw ${openclawVersion} is newer than this audit's advisory data (v${ADVISORY_TABLE_CURRENT}) — check upstream release notes and update agent-optimizer`,
      fix: "Run: npm install -g @drakon-systems/agent-optimizer@latest",
    });
  }

  // Check each advisory
  const applicable = ADVISORIES.filter((a) => isOlderThan(openclawVersion, a.fixedIn));

  if (applicable.length === 0) {
    results.push({
      category: "Security",
      check: "Security advisories",
      status: "pass",
      message: `No known security advisories for this version (advisory data current to v${ADVISORY_TABLE_CURRENT})`,
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
