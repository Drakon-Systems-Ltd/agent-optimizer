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
  // v2026.7.1 fixes — GitHub Security Advisories published 2026-09-11
  {
    fixedIn: "2026.7.1",
    severity: "fail",
    check: "MCP config owner auth (GHSA-wwx7-573h-pqwc)",
    message: "GHSA-wwx7-573h-pqwc: /mcp set and /mcp unset from an authorized non-owner channel sender persist Gateway MCP server configuration — a sender-chosen stdio MCP process then starts under the OpenClaw user (CVSS 8.8)",
    fix: "Upgrade to OpenClaw v2026.7.1+. Until then, disable MCP chat commands in external channels and review mcp.servers for unexpected entries",
  },
  {
    fixedIn: "2026.7.1",
    severity: "fail",
    check: "Codex computer-use install owner auth (GHSA-pjjr-5qhr-5w6r)",
    message: "GHSA-pjjr-5qhr-5w6r: an authorized non-owner channel sender could trigger the Codex computer-use plugin installation and start its MCP process on the host (CVSS 8.8)",
    fix: "Upgrade to OpenClaw v2026.7.1+. Until then, disable Codex computer-use installation in message channels",
  },
  {
    fixedIn: "2026.7.1",
    severity: "fail",
    check: "Claude permission replies owner auth (GHSA-p5g8-m35v-7m82)",
    message: "GHSA-p5g8-m35v-7m82: a non-owner channel sender could approve or deny a pending Claude Code permission request through the MCP channel bridge (CVSS 8.0)",
    fix: "Upgrade to OpenClaw v2026.7.1+. Until then, avoid delivering Claude permission prompts to shared channels",
  },
  {
    fixedIn: "2026.7.1",
    severity: "fail",
    check: "Browser proxy admin scope (GHSA-jghr-xp78-995p)",
    message: "GHSA-jghr-xp78-995p: a write-scoped caller in an identity-bearing Gateway deployment could reach browser control via node.invoke, bypassing the admin scope required for browser.request (CVSS 8.3)",
    fix: "Upgrade to OpenClaw v2026.7.1+",
  },
  {
    fixedIn: "2026.7.1",
    severity: "fail",
    check: "chat.send owner-only tools (GHSA-qw7m-h363-33qw)",
    message: "GHSA-qw7m-h363-33qw: a write-scoped non-owner caller could start a chat turn whose tool inventory included the owner-only gateway and cron tools (CVSS 7.6)",
    fix: "Upgrade to OpenClaw v2026.7.1+. Until then, restrict chat.send to administrators",
  },
  {
    fixedIn: "2026.7.1",
    severity: "fail",
    check: "Signal reaction approval binding (GHSA-r88x-r7jj-f2cf)",
    message: "GHSA-r88x-r7jj-f2cf: a Signal approval reaction could attach to ordinary outbound text instead of the pending approval request, so a reaction to unrelated text may resolve a host action (CVSS 7.1)",
    fix: "Upgrade to OpenClaw v2026.7.1+. Until then, avoid reaction-based approvals in Signal",
  },
  {
    fixedIn: "2026.7.1",
    severity: "warn",
    check: "Windows allowlist workspace shadowing (GHSA-rgjw-6v73-php6)",
    message: "GHSA-rgjw-6v73-php6: on Windows allowlist mode, PowerShell command analysis approves a binary from PATH but can run a same-named binary from the workspace directory (CVSS 6.7)",
    fix: "Upgrade to OpenClaw v2026.7.1+",
  },
  {
    fixedIn: "2026.7.1",
    severity: "warn",
    check: "Active Memory global toggle owner check (GHSA-xw9g-7xvv-gcjc)",
    message: "GHSA-xw9g-7xvv-gcjc: an authorized non-owner external-channel sender could enable or disable Active Memory globally for the Gateway (CVSS 6.3)",
    fix: "Upgrade to OpenClaw v2026.7.1+. Until then, disable global Active Memory commands in external channels",
  },
  {
    fixedIn: "2026.7.1",
    severity: "warn",
    check: "Group activation owner auth (GHSA-q9j5-4xr6-xqqw)",
    message: "GHSA-q9j5-4xr6-xqqw: an authorized non-owner channel sender could change whether a group requires mention-based activation via /activation (CVSS 5.4)",
    fix: "Upgrade to OpenClaw v2026.7.1+. Until then, disable activation-setting commands in shared channels",
  },
  // v2026.8.1 fixes
  {
    fixedIn: "2026.8.1",
    severity: "fail",
    check: "Codex native tools per-chat policy (GHSA-wwcw-jfpp-gpxw)",
    message: "GHSA-wwcw-jfpp-gpxw: a conversation-level tools.allow rule filtered OpenClaw tools but not the shell, process, file and patch tools owned by the Codex app-server runtime (CVSS 8.8)",
    fix: "Upgrade to OpenClaw v2026.8.1+",
  },
  {
    fixedIn: "2026.8.1",
    severity: "fail",
    check: "Inbound voice calls owner authority (GHSA-rrxp-5mx8-mvhh)",
    message: "GHSA-rrxp-5mx8-mvhh: classic inbound voice calls launched the agent without the caller's identity or non-owner status, so owner-only tool filtering failed open for admitted remote callers (CVSS 8.8)",
    fix: "Upgrade @openclaw/voice-call (OpenClaw v2026.8.1+). Until then, disable classic inbound calling or route it to a read-only agent",
  },
  {
    fixedIn: "2026.8.1",
    severity: "fail",
    check: "Agent cron tool operator command jobs (GHSA-hpg5-cq3m-phqp)",
    message: "GHSA-hpg5-cq3m-phqp: a model-visible agent caller could read the stored environment of, and trigger, ownerless operator command cron jobs routed to the same agent (CVSS 8.3)",
    fix: "Upgrade to OpenClaw v2026.8.1+",
  },
  {
    fixedIn: "2026.8.1",
    severity: "fail",
    check: "Matrix case-distinct user ID conflation (GHSA-hgv5-f2r3-6v9r)",
    message: "GHSA-hgv5-f2r3-6v9r: Matrix authorization lowercased complete user IDs, so distinct accounts could normalize to the same allowlist/owner/approver identity (CVSS 7.5)",
    fix: "Upgrade @openclaw/matrix (OpenClaw v2026.8.1+) and review allowlists for IDs differing only by case",
  },
  {
    fixedIn: "2026.8.1",
    severity: "fail",
    check: "Browser CDP DNS pinning (GHSA-p3h6-v2h4-36q2)",
    message: "GHSA-p3h6-v2h4-36q2: remote CDP hostnames were validated once but the WebSocket/Playwright transports re-resolved DNS independently, so the Gateway could connect to a policy-denied address (CVSS 8.2)",
    fix: "Upgrade to OpenClaw v2026.8.1+",
  },
  {
    fixedIn: "2026.8.1",
    severity: "fail",
    check: "Config revision hash verifier (GHSA-qgj5-6x35-9g6f)",
    message: "GHSA-qgj5-6x35-9g6f: redacted config responses included deterministic hashes over the unredacted config, which act as an offline verifier for a low-entropy Gateway passphrase (CVSS 7.5)",
    fix: "Upgrade to OpenClaw v2026.8.1+ and use a high-entropy gateway token or passphrase",
  },
  {
    fixedIn: "2026.8.1",
    severity: "warn",
    check: "Outbound attachment read denials (GHSA-w5x7-c87m-3jpc)",
    message: "GHSA-w5x7-c87m-3jpc: outbound attachment handling read local paths without the originating sender's toolsBySender policy, so a sender denied filesystem reads could still receive a known host file (CVSS 6.5)",
    fix: "Upgrade to OpenClaw v2026.8.1+",
  },
  {
    fixedIn: "2026.8.1",
    severity: "warn",
    check: "Slack file download authorization (GHSA-v7hh-7676-rg67)",
    message: "GHSA-v7hh-7676-rg67: Slack download-file authorization failed open when a file lacked share metadata, allowing retrieval outside the caller's conversation scope (CVSS 6.5)",
    fix: "Upgrade @openclaw/slack (OpenClaw v2026.8.1+)",
  },
  {
    fixedIn: "2026.8.1",
    severity: "warn",
    check: "WhatsApp session reset command auth (GHSA-mm7m-wcgh-8mfq)",
    message: "GHSA-mm7m-wcgh-8mfq: a command-denied WhatsApp group sender could use /new <model> to reset the shared group session and persist a provider/model override (CVSS 6.3)",
    fix: "Upgrade to OpenClaw v2026.8.1+",
  },
  {
    fixedIn: "2026.8.1",
    severity: "warn",
    check: "Azure Speech workspace endpoint override (GHSA-pfrw-r5vr-89hw)",
    message: "GHSA-pfrw-r5vr-89hw: the workspace dotenv filter did not block the _ENDPOINT suffix, so untrusted workspace content could redirect Azure Speech requests (and their auth header) to a chosen endpoint (CVSS 5.5)",
    fix: "Upgrade to OpenClaw v2026.8.1+. If you ran OpenClaw in untrusted workspace content, reissue the Azure Speech resource's access material",
  },
  {
    fixedIn: "2026.8.1",
    severity: "warn",
    check: "Usage CSV formula injection (GHSA-xx9p-hc9w-6p5h)",
    message: "GHSA-xx9p-hc9w-6p5h: Control UI usage CSV export did not neutralize leading formula characters in session labels, so opening the export in a spreadsheet could evaluate sender-influenced cells (CVSS 5.4)",
    fix: "Upgrade to OpenClaw v2026.8.1+",
  },
  {
    fixedIn: "2026.8.1",
    severity: "warn",
    check: "OpenAI-compatible endpoint misrouting (GHSA-vhpg-cq3w-v8p9)",
    message: "GHSA-vhpg-cq3w-v8p9: after a model hot reload, a pinned third-party OpenAI-compatible session lacking a concrete base URL could send its provider auth header to the SDK default endpoint (CVSS 5.4)",
    fix: "Upgrade to OpenClaw v2026.8.1+. If you observed misleading auth errors on a third-party provider, reissue that provider's access material",
  },
  {
    fixedIn: "2026.8.1",
    severity: "warn",
    check: "QQBot voice filename traversal (GHSA-rm45-4jx5-2927)",
    message: "GHSA-rm45-4jx5-2927: QQBot voice attachment filenames were decoded twice, so encoded traversal segments could escape the voice staging directory (CVSS 5.4)",
    fix: "Upgrade to OpenClaw v2026.8.1+",
  },
  {
    fixedIn: "2026.8.1",
    severity: "warn",
    check: "sessions.create admin scope (GHSA-j4mm-p864-vx7f)",
    message: "GHSA-j4mm-p864-vx7f: an operator.write caller could target an existing session key via sessions.create with model/thinking changes that sessions.patch reserves for operator.admin (CVSS 5.4)",
    fix: "Upgrade to OpenClaw v2026.8.1+",
  },
  {
    fixedIn: "2026.8.1",
    severity: "warn",
    check: "Twilio pre-auth rate-limit lockout (GHSA-xw48-j584-r73h)",
    message: "GHSA-xw48-j584-r73h: the SMS webhook applied its invalid-request rate limit before signature verification keyed on the raw proxy socket, so an unauthenticated sender behind a shared proxy could lock out valid Twilio callbacks (CVSS 5.3)",
    fix: "Upgrade to OpenClaw v2026.8.1+",
  },
  {
    fixedIn: "2026.8.1",
    severity: "warn",
    check: "Feishu unpin cross-context policy (GHSA-h9jh-75j7-7hhx)",
    message: "GHSA-h9jh-75j7-7hhx: the Feishu unpin action's native chatId was not declared as a delivery target, bypassing the same-provider cross-context check (CVSS 4.3)",
    fix: "Upgrade to OpenClaw v2026.8.1+",
  },
  {
    fixedIn: "2026.8.1",
    severity: "warn",
    check: "Active Memory recall requester policy (GHSA-wjfv-5qch-m5vj)",
    message: "GHSA-wjfv-5qch-m5vj: Active Memory automatic recall ignored the requester's effective tool policy, injecting durable memory even when toolsBySender denied memory tools (CVSS 3.1)",
    fix: "Upgrade to OpenClaw v2026.8.1+",
  },
  // v2026.8.2 fixes
  {
    fixedIn: "2026.8.2",
    severity: "warn",
    check: "Browser relay pending-auth exhaustion (GHSA-m78m-7h3q-q938)",
    message: "GHSA-m78m-7h3q-q938: the Browser extension relay reserved global pending-authentication slots before relay-key possession was proven, so an unauthenticated network source could block paired extensions from authenticating (CVSS 5.3)",
    fix: "Upgrade to OpenClaw v2026.8.2+. Until then, keep the browser relay route off lower-trust networks",
  },
  // v2026.8.11 fixes
  {
    fixedIn: "2026.8.11",
    severity: "fail",
    check: "iOS Control UI TLS pin enforcement (GHSA-jjpc-p3xf-8g7p)",
    message: "GHSA-jjpc-p3xf-8g7p: the iOS Control UI Terminal and Dashboard WebViews omitted the saved Gateway TLS fingerprint, so a redirected host with a system-trusted certificate could serve a replacement page that reads the injected Gateway token (CVSS 8.3; affects 2026.7.1 through 2026.8.10)",
    fix: "Upgrade to OpenClaw v2026.8.11+ and update the iOS app",
  },
  // v2026.9.3 fixes
  {
    fixedIn: "2026.9.3",
    severity: "warn",
    check: "Discord asset upload media policy (GHSA-xvwp-wmh2-fq48)",
    message: "GHSA-xvwp-wmh2-fq48: Discord emoji/sticker upload actions lost the sender-scoped media policy before loading a local file, allowing an out-of-policy host path into an outbound upload (CVSS 5.3)",
    fix: "Upgrade @openclaw/discord (OpenClaw v2026.9.3+). Until then, deny Discord asset upload actions to lower-trust senders",
  },
  {
    fixedIn: "2026.9.3",
    severity: "warn",
    check: "Prometheus diagnostics operator.read (GHSA-rx8p-qcpv-c7vr)",
    message: "GHSA-rx8p-qcpv-c7vr: the Prometheus diagnostics plugin did not enforce operator.read on its authenticated metrics endpoint, exposing metrics to identity-bearing callers without read scope (CVSS 4.3)",
    fix: "Upgrade @openclaw/diagnostics-prometheus (OpenClaw v2026.9.3+)",
  },
];

// Newest OpenClaw release this advisory table covers. Bump when refreshing the
// table — the version-currency checks below key off it.
export const ADVISORY_TABLE_CURRENT = "2026.9.4";

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
