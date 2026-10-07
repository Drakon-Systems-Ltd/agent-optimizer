import type { AuditResult, OpenClawConfig } from "../../types.js";

// Legacy config paths that OpenClaw's doctor migrates (2026.5–2026.9 window).
// Sources: src/commands/doctor/shared/legacy-config-migrations.*.ts and
// legacy-config-core-migrate.ts in OpenClaw 2026.9.4 and 2026.9.8, and
// src/config/web-search-legacy-provider-keys.ts (unchanged through 2026.9.8).
// (bundled as dist/legacy-*.mjs). Rule messages mirror the upstream
// legacyRules so `openclaw doctor` and this audit tell the same story.

const LEGACY_TOP_LEVEL: Array<{ key: string; target: string }> = [
  { key: "memorySearch", target: "memory.search" },
  { key: "heartbeat", target: "agents.defaults.heartbeat" },
  { key: "routing", target: "channel config (channels.*, dmPolicy/groupPolicy)" },
  { key: "canvasHost", target: "surfaces" },
  { key: "crestodian", target: "built-in system-agent rescue policy (crestodian config was retired)" },
];

const LEGACY_DEFAULTS_KEYS: Array<{ key: string; note: string }> = [
  { key: "embeddedPi", note: "Pi runtime was internalized — use agents.defaults.embeddedAgent; runtime is set per-agent via agents.entries.*.runtime" },
  { key: "embeddedHarness", note: "removed — set provider/model runtime policy instead" },
  { key: "agentRuntime", note: "ignored — set models.providers.<provider>.agentRuntime or a model-scoped agentRuntime" },
  { key: "llm", note: "removed — use models.providers.<id>.timeoutSeconds for slow model/provider timeouts" },
  { key: "silentReplyRewrite", note: "removed — exact NO_REPLY is no longer rewritten to visible fallback text" },
  { key: "memorySearch", note: "moved to memory.search" },
  { key: "systemPromptOverride", note: "removed — OpenClaw owns the generated system prompt" },
];

// Legacy tools.web.search.<provider> blocks — moved to
// plugins.entries.<plugin>.config.webSearch.
const LEGACY_WEB_SEARCH_PROVIDERS = [
  "brave", "duckduckgo", "exa", "firecrawl", "gemini", "grok",
  "kimi", "minimax", "ollama", "perplexity", "searxng", "tavily",
];

// Legacy provider id -> owning plugin id (LEGACY_WEB_SEARCH_OWNERS upstream).
const WEB_SEARCH_PLUGIN_OWNER: Record<string, string> = {
  gemini: "google", grok: "xai", kimi: "moonshot",
};

// messages.queue.mode values retired in 2026.9 (RETIRED_QUEUE_MODES upstream).
const RETIRED_QUEUE_MODES = new Set(["queue", "steer-backlog", "steer+backlog"]);

// Retired xAI models that doctor rewrites under tools.web.x_search.model.
const RETIRED_X_SEARCH_MODELS = new Set([
  "grok-4-1-fast-non-reasoning", "grok-4-fast-non-reasoning", "grok-3",
]);

// gateway.bind values that are host aliases rather than bind modes.
const LEGACY_BIND_HOST_ALIASES = new Set(["0.0.0.0", "localhost", "127.0.0.1", "::", "::1"]);

// Simple path-presence rules: flagged whenever the value at `path` is set.
// `match` narrows to specific legacy values where the key itself is still valid.
interface LegacyPathRule {
  path: string[];
  check: string;
  message: string;
  fix?: string;
  match?: (value: unknown) => boolean;
}

const doctorFix = "Run: openclaw doctor --fix (migrates legacy keys in place)";

const LEGACY_PATH_RULES: LegacyPathRule[] = [
  // channels / routing (legacy-config-migrations.channels.ts)
  {
    path: ["channels", "telegram", "requireMention"],
    check: "channels.telegram.requireMention",
    message: 'channels.telegram.requireMention was removed — use channels.telegram.groups."*".requireMention instead',
  },
  {
    path: ["routing", "groupChat", "requireMention"],
    check: "routing.groupChat.requireMention",
    message: 'routing.groupChat.requireMention was removed — use channels.<channel>.groups."*".requireMention instead (doctor migrates it into each configured WhatsApp/Telegram/iMessage channel)',
  },
  {
    path: ["routing", "groupChat", "historyLimit"],
    check: "routing.groupChat.historyLimit",
    message: "routing.groupChat.historyLimit was moved — use messages.groupChat.historyLimit instead",
  },
  {
    path: ["routing", "groupChat", "mentionPatterns"],
    check: "routing.groupChat.mentionPatterns",
    message: "routing.groupChat.mentionPatterns was moved — use messages.groupChat.mentionPatterns instead",
  },
  {
    path: ["routing", "allowFrom"],
    check: "routing.allowFrom",
    message: "routing.allowFrom was removed — use channels.whatsapp.allowFrom instead",
  },
  {
    path: ["channels", "webchat"],
    check: "channels.webchat",
    message: "channels.webchat is retired — Control UI config lives under gateway.controlUi",
  },
  // tools.web.* (web-search-legacy-provider-keys.ts)
  {
    path: ["tools", "web", "search", "apiKey"],
    check: "tools.web.search.apiKey",
    message: "tools.web.search.apiKey is a legacy global search key — provider auth moved to plugins.entries.<provider>.config.webSearch.apiKey (doctor moves a bare apiKey to plugins.entries.brave.config.webSearch.apiKey)",
  },
  {
    path: ["tools", "web", "fetch", "firecrawl"],
    check: "tools.web.fetch.firecrawl",
    message: "tools.web.fetch.firecrawl is a legacy block — Firecrawl fetch config moved to plugins.entries.firecrawl.config.webFetch",
  },
  {
    path: ["tools", "web", "x_search", "apiKey"],
    check: "tools.web.x_search.apiKey",
    message: "tools.web.x_search.apiKey moved to the xAI plugin — use plugins.entries.xai.config.webSearch.apiKey instead",
  },
  {
    path: ["tools", "web", "x_search", "model"],
    check: "tools.web.x_search.model",
    message: "tools.web.x_search.model uses a retired xAI model — doctor rewrites it to grok-4.3",
    match: (v) => typeof v === "string" && RETIRED_X_SEARCH_MODELS.has(v.trim().toLowerCase()),
  },
  // messages (legacy-config-migrations.queue.ts, tts)
  {
    path: ["messages", "queue", "mode"],
    check: "messages.queue.mode",
    message: "messages.queue.mode uses a retired queue mode — use steer, followup, collect, or interrupt (doctor maps \"queue\" → \"steer\", steer-backlog/steer+backlog → \"followup\")",
    match: (v) => typeof v === "string" && RETIRED_QUEUE_MODES.has(v),
  },
  {
    path: ["messages", "queue", "byChannel"],
    check: "messages.queue.byChannel",
    message: "messages.queue.byChannel contains a retired queue mode — use steer, followup, collect, or interrupt",
    match: (v) =>
      !!v && typeof v === "object" &&
      Object.values(v as Record<string, unknown>).some((m) => typeof m === "string" && RETIRED_QUEUE_MODES.has(m)),
  },
  {
    path: ["messages", "tts"],
    check: "messages.tts",
    message: "messages.tts moved to top-level tts",
  },
  {
    path: ["tts", "enabled"],
    check: "tts.enabled",
    message: "tts.enabled is legacy — use tts.auto",
  },
  // session
  {
    path: ["session", "threadBindings", "ttlHours"],
    check: "session.threadBindings.ttlHours",
    message: "session.threadBindings.ttlHours was renamed to session.threadBindings.idleHours",
  },
  {
    path: ["session", "threadBindings", "spawnSubagentSessions"],
    check: "session.threadBindings.spawnSubagentSessions",
    message: "session.threadBindings.spawnSubagentSessions/spawnAcpSessions were replaced by session.threadBindings.spawnSessions",
  },
  {
    path: ["session", "threadBindings", "spawnAcpSessions"],
    check: "session.threadBindings.spawnAcpSessions",
    message: "session.threadBindings.spawnSubagentSessions/spawnAcpSessions were replaced by session.threadBindings.spawnSessions",
  },
  {
    path: ["session", "typingMode"],
    check: "session.typingMode",
    message: "session.typingMode moved to agents.defaults.typingMode",
  },
  {
    path: ["session", "maintenance", "rotateBytes"],
    check: "session.maintenance.rotateBytes",
    message: "session.maintenance.rotateBytes is deprecated and ignored",
    fix: "Run: openclaw doctor --fix (removes it)",
  },
  {
    path: ["session", "parentForkMaxTokens"],
    check: "session.parentForkMaxTokens",
    message: "session.parentForkMaxTokens was removed — parent fork sizing is automatic",
    fix: "Run: openclaw doctor --fix (removes it)",
  },
  {
    path: ["session", "resetByType", "dm"],
    check: "session.resetByType.dm",
    message: "session.resetByType.dm was renamed to direct",
  },
  // cron
  {
    path: ["cron", "webhook"],
    check: "cron.webhook",
    message: "cron.webhook was retired after per-job delivery migration — use per-job delivery.mode/webhook instead",
  },
  {
    path: ["cron", "runLog"],
    check: "cron.runLog",
    message: "cron.runLog is retired — run history now has fixed per-job retention",
  },
  // agents
  {
    path: ["agents", "list"],
    check: "agents.list",
    message: "agents.list moved to keyed agents.entries",
  },
  {
    path: ["agents", "defaults", "sandbox", "perSession"],
    check: "agents.defaults.sandbox.perSession",
    message: "agents.defaults.sandbox.perSession is legacy — use agents.defaults.sandbox.scope instead",
  },
  {
    path: ["agents", "defaults", "model", "timeoutMs"],
    check: "agents.defaults.model.timeoutMs",
    message: "agents.defaults.model.timeoutMs is ignored — agent model config only selects primary/fallback models",
    fix: "Run: openclaw doctor --fix (removes it)",
  },
  {
    path: ["agents", "defaults", "silentReply", "direct"],
    check: "agents.defaults.silentReply.direct",
    message: "agents.defaults.silentReply.direct was removed — direct chats never receive NO_REPLY prompt guidance",
    fix: "Run: openclaw doctor --fix (removes it)",
  },
  // gateway
  {
    path: ["gateway", "bind"],
    check: "gateway.bind",
    message: "gateway.bind host aliases (0.0.0.0/localhost) are legacy — use bind modes (lan/loopback/custom/tailnet/auto) instead",
    match: (v) => typeof v === "string" && LEGACY_BIND_HOST_ALIASES.has(v.trim().toLowerCase()),
  },
  {
    path: ["gateway", "tailscale", "resetOnExit"],
    check: "gateway.tailscale.resetOnExit",
    message: "gateway.tailscale.resetOnExit is retired — managed routes now follow the Gateway lifecycle automatically",
  },
  {
    path: ["gateway", "tailscale", "serviceName"],
    check: "gateway.tailscale.serviceName",
    message: "gateway.tailscale.serviceName is retired — named Services require persistent background routes that cannot follow the Gateway lifecycle",
  },
  {
    path: ["gateway", "controlUi", "dangerouslyDisableDeviceAuth"],
    check: "gateway.controlUi.dangerouslyDisableDeviceAuth",
    message: "gateway.controlUi.dangerouslyDisableDeviceAuth is retired and ignored — Control UI browsers pair through the normal device flow",
    fix: "Run: openclaw doctor --fix (removes the legacy key)",
  },
  {
    path: ["gateway", "controlUi", "toolTitles"],
    check: "gateway.controlUi.toolTitles",
    message: "gateway.controlUi.toolTitles is retired — tool activity uses agent-provided descriptions automatically",
    fix: "Run: openclaw doctor --fix (removes it)",
  },
  // skills / plugins / diagnostics
  {
    path: ["skills", "workshop", "autonomous", "enabled"],
    check: "skills.workshop.autonomous.enabled",
    message: "skills.workshop.autonomous.enabled is retired — use skills.workshop.autonomous.mode",
  },
  {
    path: ["skills", "workshop", "allowSymlinkTargetWrites"],
    check: "skills.workshop.allowSymlinkTargetWrites",
    message: "skills.workshop.allowSymlinkTargetWrites is retired — Skill Workshop writes only inside its own directory",
  },
  {
    path: ["plugins", "entries", "codex-supervisor"],
    check: "plugins.entries.codex-supervisor",
    message: "plugins.entries.codex-supervisor is retired — use plugins.entries.codex.config.supervision",
  },
  {
    path: ["plugins", "entries", "openai-codex"],
    check: "plugins.entries.openai-codex",
    message: "plugins.openai-codex references are retired — use the openai plugin id",
  },
  {
    path: ["diagnostics", "otel", "protocol"],
    check: "diagnostics.otel.protocol",
    message: 'diagnostics.otel.protocol = "grpc" is no longer accepted because gRPC export is not implemented',
    fix: "Run: openclaw doctor --fix, then configure an OTLP/HTTP collector before re-enabling telemetry",
    match: (v) => typeof v === "string" && v.trim().toLowerCase() === "grpc",
  },
  // 2026.9.5–2026.9.8 doctor migrations.
  {
    path: ["tools", "toolSearch", "mode"],
    check: "tools.toolSearch.mode",
    message: "tools.toolSearch.mode = code is retired — use structured Tool Search (tools)",
    match: (v) => v === "code",
  },
  {
    path: ["tools", "toolSearch", "codeTimeoutMs"],
    check: "tools.toolSearch.codeTimeoutMs",
    message: "tools.toolSearch.codeTimeoutMs is retired — Tool Search no longer executes code",
  },
  {
    path: ["plugins", "entries", "github-copilot", "config", "discovery", "enabled"],
    check: "plugins.entries.github-copilot.config.discovery.enabled",
    message: "GitHub Copilot discovery.enabled is retired — discovery now refreshes automatically; use agents.defaults.modelPolicy.allow to hide models",
  },
  {
    path: ["plugins", "entries", "github-copilot", "config", "discovery"],
    check: "plugins.entries.github-copilot.config.discovery",
    message: "An empty GitHub Copilot discovery block is retired — discovery now refreshes automatically",
    match: (v) => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0,
  },
  {
    path: ["agents", "defaults", "silentReply", "internal"],
    check: "agents.defaults.silentReply.internal",
    message: "agents.defaults.silentReply.internal was removed — only channel groups may use NO_REPLY",
  },
];

function getPath(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function isToolPolicyPath(path: string[]): boolean {
  if (path.at(-1) === "tools" || path.includes("toolsBySender")) return true;
  const i = path.lastIndexOf("byProvider");
  return i >= 0 && path.slice(0, i).includes("tools");
}

function readGrantList(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string")
    ? value as string[]
    : undefined;
}

export function auditLegacyConfigKeys(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];

  for (const { key, target } of LEGACY_TOP_LEVEL) {
    if (key in config && config[key] != null) {
      results.push({
        category: "Legacy Config",
        check: `Top-level ${key}`,
        status: "warn",
        message: `Top-level "${key}" is a legacy location — current OpenClaw reads ${target}`,
        fix: doctorFix,
      });
    }
  }

  const defaults = config.agents?.defaults as Record<string, unknown> | undefined;
  if (defaults) {
    for (const { key, note } of LEGACY_DEFAULTS_KEYS) {
      if (key in defaults && defaults[key] != null) {
        results.push({
          category: "Legacy Config",
          check: `agents.defaults.${key}`,
          status: "warn",
          message: `agents.defaults.${key} is a removed legacy key — ${note}`,
          fix: doctorFix,
        });
      }
    }
  }

  const session = config.session as Record<string, unknown> | undefined;
  if (session && typeof session === "object") {
    const maintenance = session.maintenance as Record<string, unknown> | undefined;
    if (maintenance && typeof maintenance === "object" && maintenance.pruneDays != null) {
      results.push({
        category: "Legacy Config",
        check: "session.maintenance.pruneDays",
        status: "warn",
        message: "session.maintenance.pruneDays is deprecated — use session.maintenance.pruneAfter",
        fix: "Rename pruneDays to pruneAfter (interval string, e.g. \"30d\")",
      });
    }
    if (session.threadBindings != null) {
      results.push({
        category: "Legacy Config",
        check: "session.threadBindings",
        status: "warn",
        message: "session.threadBindings is a legacy key with a doctor migration",
        fix: doctorFix,
      });
    }
  }

  const gateway = config.gateway as Record<string, unknown> | undefined;
  if (gateway && typeof gateway === "object" && gateway.webchat != null) {
    results.push({
      category: "Legacy Config",
      check: "gateway.webchat",
      status: "warn",
      message: "gateway.webchat is a legacy key — Control UI config moved under gateway.controlUi",
      fix: doctorFix,
    });
  }

  const webSearch = (config.tools as Record<string, unknown> | undefined)?.web as
    | { search?: Record<string, unknown> }
    | undefined;
  if (webSearch?.search && typeof webSearch.search === "object") {
    const legacyBlocks = LEGACY_WEB_SEARCH_PROVIDERS.filter(
      (p) => webSearch.search![p] != null
    );
    if (legacyBlocks.length > 0) {
      const targets = legacyBlocks
        .map((p) => `plugins.entries.${WEB_SEARCH_PLUGIN_OWNER[p] ?? p}.config.webSearch`)
        .join(", ");
      results.push({
        category: "Legacy Config",
        check: "Web search provider blocks",
        status: "warn",
        message: `tools.web.search.{${legacyBlocks.join(", ")}} are legacy provider blocks — provider config moved to plugins.entries.<plugin>.config.webSearch (${targets})`,
        fix: doctorFix,
      });
    }
  }

  for (const rule of LEGACY_PATH_RULES) {
    const value = getPath(config, rule.path);
    if (value === undefined || value === null) continue;
    if (rule.match && !rule.match(value)) continue;
    results.push({
      category: "Legacy Config",
      check: rule.check,
      status: "warn",
      message: rule.message,
      fix: rule.fix ?? doctorFix,
    });
  }

  // Code Mode rules use own-key presence, including keys with null values.
  const reportCodeMode = (scope: unknown, label: string): void => {
    const codeMode = getPath(scope, ["tools", "codeMode"]);
    if (!codeMode || typeof codeMode !== "object" || Array.isArray(codeMode)) return;
    const record = codeMode as Record<string, unknown>;
    if (Object.hasOwn(record, "languages")) {
      results.push({ category: "Legacy Config", check: `${label}tools.codeMode.languages`, status: "warn",
        message: `${label}tools.codeMode.languages is retired — Code Mode now runs JavaScript only`,
        fix: doctorFix });
    }
    if (Object.hasOwn(record, "runtime")) {
      const path = `${label}tools.codeMode`;
      results.push({ category: "Legacy Config", check: `${path}.runtime`, status: "warn",
        message: record.runtime === "quickjs-wasi"
          ? `${path}.runtime moved to ${path}.executor (quickjs-wasi becomes quickjs)`
          : `${path}.runtime is retired — use ${path}.executor (openclaw doctor --fix only migrates quickjs-wasi)`,
        fix: doctorFix });
    }
  };
  reportCodeMode(config, "");

  // Per-agent Code Mode keys. Mirrors OpenClaw 2026.9.8 visitAgentEntries:
  // agents.entries.<id> when present, otherwise agents.list[i].
  const agentScopes: Array<[string, unknown]> = [];
  const agentEntries = getPath(config, ["agents", "entries"]);
  const agentList = getPath(config, ["agents", "list"]);
  if (agentEntries && typeof agentEntries === "object" && !Array.isArray(agentEntries)) {
    for (const [id, agent] of Object.entries(agentEntries as Record<string, unknown>)) {
      agentScopes.push([`agents.entries.${id}`, agent]);
    }
  } else if (Array.isArray(agentList)) {
    agentList.forEach((agent, index) => agentScopes.push([`agents.list[${index}]`, agent]));
  }
  for (const [label, agent] of agentScopes) {
    reportCodeMode(agent, `${label}.`);
  }
  const surfaces = getPath(config, ["surfaces"]);
  if (surfaces && typeof surfaces === "object" && !Array.isArray(surfaces)) {
    for (const [id, surface] of Object.entries(surfaces as Record<string, unknown>)) {
      for (const key of ["direct", "internal"]) {
        if (getPath(surface, ["silentReply", key]) == null) continue;
        results.push({ category: "Legacy Config", check: `surfaces.${id}.silentReply.${key}`, status: "warn",
          message: `surfaces.${id}.silentReply.${key} was removed — only channel groups may use NO_REPLY`, fix: doctorFix });
      }
    }
  }

  // Doctor merges safe allow/alsoAllow conflicts in core-owned tool policies.
  const scanToolPolicies = (value: unknown, path: string[]): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => scanToolPolicies(entry, [...path, String(index)]));
      return;
    }
    const record = value as Record<string, unknown>;
    if (path.at(-2) === "tools" && path.at(-1) === "sandbox") return;
    if (isToolPolicyPath(path) && readGrantList(record, "allow") && readGrantList(record, "alsoAllow")) {
      const label = path.join(".");
      results.push({ category: "Legacy Config", check: `${label}.allow/alsoAllow`, status: "warn",
        message: `${label} sets both allow and alsoAllow — doctor can merge safe conflicts; otherwise review the permission policy manually`,
        fix: doctorFix });
    }
    for (const [key, entry] of Object.entries(record)) scanToolPolicies(entry, [...path, key]);
  };
  for (const root of ["tools", "agents", "channels", "gateway"]) {
    scanToolPolicies(getPath(config, [root]), [root]);
  }

  // channels.feishu.accounts.<id>.botName → .name
  const feishuAccounts = getPath(config, ["channels", "feishu", "accounts"]);
  if (feishuAccounts && typeof feishuAccounts === "object" && !Array.isArray(feishuAccounts)) {
    for (const [id, acct] of Object.entries(feishuAccounts as Record<string, unknown>)) {
      if (acct && typeof acct === "object" && "botName" in (acct as Record<string, unknown>)) {
        results.push({
          category: "Legacy Config",
          check: `channels.feishu.accounts.${id}.botName`,
          status: "warn",
          message: `channels.feishu.accounts.${id}.botName was renamed to channels.feishu.accounts.${id}.name`,
          fix: doctorFix,
        });
      }
    }
  }

  // bindings[].match.peer.kind "dm" → "direct"
  const bindings = config.bindings;
  if (Array.isArray(bindings)) {
    const dmIdx = bindings
      .map((b, i) => (getPath(b, ["match", "peer", "kind"]) === "dm" ? i : -1))
      .filter((i) => i >= 0);
    if (dmIdx.length > 0) {
      results.push({
        category: "Legacy Config",
        check: "bindings[].match.peer.kind",
        status: "warn",
        message: `bindings[${dmIdx.join(", ")}].match.peer.kind uses the retired "dm" alias — use "direct"`,
        fix: doctorFix,
      });
    }
  }

  return results;
}
