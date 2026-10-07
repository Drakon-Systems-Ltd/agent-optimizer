import { describe, it, expect } from "vitest";
import { auditLegacyConfigKeys } from "../src/auditors/openclaw/legacy-config-keys.js";
import type { OpenClawConfig } from "../src/types.js";

describe("auditLegacyConfigKeys", () => {
  it("empty for a clean modern config", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { model: { primary: "anthropic/claude-opus-4-8" } } },
      gateway: { port: 18789 },
    };
    expect(auditLegacyConfigKeys(config)).toHaveLength(0);
  });

  it("flags legacy top-level memorySearch and heartbeat", () => {
    const config = {
      memorySearch: { enabled: true },
      heartbeat: { every: "1h" },
    } as OpenClawConfig;
    const results = auditLegacyConfigKeys(config);
    expect(results.some((r) => r.check === "Top-level memorySearch" && r.status === "warn")).toBe(true);
    expect(results.some((r) => r.check === "Top-level heartbeat" && r.status === "warn")).toBe(true);
  });

  it("flags removed agents.defaults keys with migration notes", () => {
    const config = {
      agents: { defaults: { llm: { primary: "x" }, agentRuntime: "pi" } },
    } as unknown as OpenClawConfig;
    const results = auditLegacyConfigKeys(config);
    expect(results.some((r) => r.check === "agents.defaults.llm")).toBe(true);
    expect(results.some((r) => r.check === "agents.defaults.agentRuntime")).toBe(true);
  });

  it("flags session.maintenance.pruneDays rename", () => {
    const config = {
      session: { maintenance: { pruneDays: 30 } },
    } as OpenClawConfig;
    const results = auditLegacyConfigKeys(config);
    const finding = results.find((r) => r.check === "session.maintenance.pruneDays");
    expect(finding?.status).toBe("warn");
    expect(finding?.message).toContain("pruneAfter");
  });

  it("flags legacy web-search provider blocks", () => {
    const config = {
      tools: { web: { search: { brave: { apiKey: "x" }, tavily: { apiKey: "y" }, enabled: true } } },
    } as unknown as OpenClawConfig;
    const results = auditLegacyConfigKeys(config);
    const finding = results.find((r) => r.check === "Web search provider blocks");
    expect(finding?.status).toBe("warn");
    expect(finding?.message).toContain("brave");
    expect(finding?.message).toContain("tavily");
  });

  it("flags gateway.webchat and session.threadBindings", () => {
    const config = {
      gateway: { webchat: {} },
      session: { threadBindings: {} },
    } as OpenClawConfig;
    const results = auditLegacyConfigKeys(config);
    expect(results.some((r) => r.check === "gateway.webchat")).toBe(true);
    expect(results.some((r) => r.check === "session.threadBindings")).toBe(true);
  });

  it("points top-level memorySearch at memory.search (2026.9.4 target)", () => {
    const results = auditLegacyConfigKeys({ memorySearch: { enabled: true } } as OpenClawConfig);
    const r = results.find((x) => x.check === "Top-level memorySearch");
    expect(r?.message).toContain("memory.search");
  });

  it("does not flag a modern config that uses the current key locations", () => {
    const config = {
      agents: { defaults: { model: { primary: "anthropic/claude-opus-4-8" }, typingMode: "instant" } },
      gateway: { port: 18789, bind: "loopback", controlUi: {} },
      channels: { telegram: { groups: { "*": { requireMention: true } } } },
      messages: { queue: { mode: "steer", byChannel: { telegram: "followup" } }, groupChat: { historyLimit: 50 } },
      plugins: { entries: { brave: { config: { webSearch: { apiKey: "x" } } }, xai: { config: { webSearch: { apiKey: "y" } } } } },
      tools: { web: { search: { enabled: true }, x_search: { model: "grok-4.3" } } },
      tts: { auto: "always" },
      diagnostics: { otel: { protocol: "http/protobuf" } },
      session: { resetByType: { direct: "daily" }, threadBindings: undefined },
      bindings: [{ match: { peer: { kind: "direct" } } }],
    } as unknown as OpenClawConfig;
    expect(auditLegacyConfigKeys(config)).toHaveLength(0);
  });

  // ── 2026.9.4 doctor migrations ──────────────────────────────────────────

  it("flags channels.telegram.requireMention with the groups.\"*\" target", () => {
    const config = { channels: { telegram: { requireMention: true } } } as unknown as OpenClawConfig;
    const r = auditLegacyConfigKeys(config).find((x) => x.check === "channels.telegram.requireMention");
    expect(r?.status).toBe("warn");
    expect(r?.message).toContain('channels.telegram.groups."*".requireMention');
  });

  it("flags routing.groupChat.requireMention / historyLimit / mentionPatterns and routing.allowFrom", () => {
    const config = {
      routing: { allowFrom: ["+44"], groupChat: { requireMention: false, historyLimit: 20, mentionPatterns: ["@bot"] } },
    } as unknown as OpenClawConfig;
    const results = auditLegacyConfigKeys(config);
    const checks = results.map((r) => r.check);
    expect(checks).toContain("routing.groupChat.requireMention");
    expect(checks).toContain("routing.groupChat.historyLimit");
    expect(checks).toContain("routing.groupChat.mentionPatterns");
    expect(checks).toContain("routing.allowFrom");
    expect(results.find((r) => r.check === "routing.groupChat.historyLimit")?.message).toContain("messages.groupChat.historyLimit");
    expect(results.find((r) => r.check === "routing.allowFrom")?.message).toContain("channels.whatsapp.allowFrom");
  });

  it("flags tools.web.search.apiKey with the plugins.entries.<provider>.config.webSearch.apiKey target", () => {
    const config = { tools: { web: { search: { apiKey: "brave-key" } } } } as unknown as OpenClawConfig;
    const r = auditLegacyConfigKeys(config).find((x) => x.check === "tools.web.search.apiKey");
    expect(r?.status).toBe("warn");
    expect(r?.message).toContain("plugins.entries.<provider>.config.webSearch.apiKey");
    expect(r?.message).toContain("plugins.entries.brave.config.webSearch.apiKey");
  });

  it("flags tools.web.fetch.firecrawl with the plugins.entries.firecrawl.config.webFetch target", () => {
    const config = { tools: { web: { fetch: { firecrawl: { apiKey: "fc" } } } } } as unknown as OpenClawConfig;
    const r = auditLegacyConfigKeys(config).find((x) => x.check === "tools.web.fetch.firecrawl");
    expect(r?.status).toBe("warn");
    expect(r?.message).toContain("plugins.entries.firecrawl.config.webFetch");
  });

  it("flags tools.web.x_search.apiKey with the plugins.entries.xai.config.webSearch.apiKey target", () => {
    const config = { tools: { web: { x_search: { apiKey: "xai" } } } } as unknown as OpenClawConfig;
    const r = auditLegacyConfigKeys(config).find((x) => x.check === "tools.web.x_search.apiKey");
    expect(r?.status).toBe("warn");
    expect(r?.message).toContain("plugins.entries.xai.config.webSearch.apiKey");
  });

  it("flags a retired tools.web.x_search.model but not a current one", () => {
    const retired = { tools: { web: { x_search: { model: "grok-3" } } } } as unknown as OpenClawConfig;
    expect(auditLegacyConfigKeys(retired).some((r) => r.check === "tools.web.x_search.model")).toBe(true);
    const current = { tools: { web: { x_search: { model: "grok-4.3" } } } } as unknown as OpenClawConfig;
    expect(auditLegacyConfigKeys(current).some((r) => r.check === "tools.web.x_search.model")).toBe(false);
  });

  it("names the owning plugin for legacy web-search provider blocks", () => {
    const config = { tools: { web: { search: { grok: { apiKey: "x" }, gemini: { apiKey: "y" } } } } } as unknown as OpenClawConfig;
    const r = auditLegacyConfigKeys(config).find((x) => x.check === "Web search provider blocks");
    expect(r?.message).toContain("plugins.entries.xai.config.webSearch");
    expect(r?.message).toContain("plugins.entries.google.config.webSearch");
  });

  it.each(["queue", "steer-backlog", "steer+backlog"])(
    "flags retired messages.queue.mode %s",
    (mode) => {
      const config = { messages: { queue: { mode } } } as unknown as OpenClawConfig;
      const r = auditLegacyConfigKeys(config).find((x) => x.check === "messages.queue.mode");
      expect(r?.status).toBe("warn");
      expect(r?.message).toContain("steer, followup, collect, or interrupt");
    }
  );

  it.each(["steer", "followup", "collect", "interrupt"])(
    "does not flag current messages.queue.mode %s",
    (mode) => {
      const config = { messages: { queue: { mode } } } as unknown as OpenClawConfig;
      expect(auditLegacyConfigKeys(config).some((r) => r.check === "messages.queue.mode")).toBe(false);
    }
  );

  it("flags a retired mode inside messages.queue.byChannel", () => {
    const config = { messages: { queue: { byChannel: { discord: "steer", slack: "queue" } } } } as unknown as OpenClawConfig;
    expect(auditLegacyConfigKeys(config).some((r) => r.check === "messages.queue.byChannel")).toBe(true);
    const clean = { messages: { queue: { byChannel: { discord: "steer", slack: "collect" } } } } as unknown as OpenClawConfig;
    expect(auditLegacyConfigKeys(clean).some((r) => r.check === "messages.queue.byChannel")).toBe(false);
  });

  it("flags the remaining 2026.9.4 retired/renamed paths", () => {
    const config = {
      channels: { webchat: {}, feishu: { accounts: { main: { botName: "Bot" } } } },
      messages: { tts: { auto: "always" } },
      tts: { enabled: true },
      session: {
        threadBindings: { ttlHours: 4, spawnSubagentSessions: true, spawnAcpSessions: false },
        typingMode: "instant",
        maintenance: { rotateBytes: 1000 },
        parentForkMaxTokens: 1000,
        resetByType: { dm: "daily" },
      },
      cron: { webhook: "https://x", runLog: { keep: 10 } },
      agents: {
        list: [{ id: "main" }],
        defaults: {
          sandbox: { perSession: true },
          model: { primary: "x", timeoutMs: 1000 },
          silentReply: { direct: true },
          memorySearch: { enabled: true },
          systemPromptOverride: "hi",
        },
      },
      gateway: {
        bind: "0.0.0.0",
        tailscale: { resetOnExit: true, serviceName: "svc" },
        controlUi: { dangerouslyDisableDeviceAuth: true, toolTitles: true },
      },
      skills: { workshop: { autonomous: { enabled: true }, allowSymlinkTargetWrites: true } },
      plugins: { entries: { "codex-supervisor": {}, "openai-codex": {} } },
      diagnostics: { otel: { protocol: "grpc" } },
      bindings: [{ match: { peer: { kind: "direct" } } }, { match: { peer: { kind: "dm" } } }],
      crestodian: { enabled: true },
    } as unknown as OpenClawConfig;
    const checks = auditLegacyConfigKeys(config).map((r) => r.check);
    for (const expected of [
      "channels.webchat",
      "channels.feishu.accounts.main.botName",
      "messages.tts",
      "tts.enabled",
      "session.threadBindings.ttlHours",
      "session.threadBindings.spawnSubagentSessions",
      "session.threadBindings.spawnAcpSessions",
      "session.typingMode",
      "session.maintenance.rotateBytes",
      "session.parentForkMaxTokens",
      "session.resetByType.dm",
      "cron.webhook",
      "cron.runLog",
      "agents.list",
      "agents.defaults.sandbox.perSession",
      "agents.defaults.model.timeoutMs",
      "agents.defaults.silentReply.direct",
      "agents.defaults.memorySearch",
      "agents.defaults.systemPromptOverride",
      "gateway.bind",
      "gateway.tailscale.resetOnExit",
      "gateway.tailscale.serviceName",
      "gateway.controlUi.dangerouslyDisableDeviceAuth",
      "gateway.controlUi.toolTitles",
      "skills.workshop.autonomous.enabled",
      "skills.workshop.allowSymlinkTargetWrites",
      "plugins.entries.codex-supervisor",
      "plugins.entries.openai-codex",
      "diagnostics.otel.protocol",
      "bindings[].match.peer.kind",
      "Top-level crestodian",
    ]) {
      expect(checks, expected).toContain(expected);
    }
  });

  it("does not flag gateway.bind modes or a non-grpc otel protocol", () => {
    for (const bind of ["lan", "loopback", "custom", "tailnet", "auto"]) {
      const config = { gateway: { bind } } as unknown as OpenClawConfig;
      expect(auditLegacyConfigKeys(config).some((r) => r.check === "gateway.bind"), bind).toBe(false);
    }
    const otel = { diagnostics: { otel: { protocol: "http/json" } } } as unknown as OpenClawConfig;
    expect(auditLegacyConfigKeys(otel).some((r) => r.check === "diagnostics.otel.protocol")).toBe(false);
  });

  it("every 2026.9.4 finding is a warn that points at openclaw doctor --fix", () => {
    const config = {
      channels: { telegram: { requireMention: true } },
      tools: { web: { search: { apiKey: "k" }, fetch: { firecrawl: { apiKey: "f" } }, x_search: { apiKey: "x" } } },
      messages: { queue: { mode: "queue" } },
    } as unknown as OpenClawConfig;
    const results = auditLegacyConfigKeys(config);
    expect(results.length).toBeGreaterThanOrEqual(5);
    expect(results.every((r) => r.status === "warn" && r.category === "Legacy Config")).toBe(true);
    expect(results.every((r) => r.fix?.includes("openclaw doctor --fix"))).toBe(true);
  });

  // ── 2026.9.5–2026.9.8 doctor migrations ─────────────────────────────────

  it("flags global and per-agent Code Mode keys", () => {
    const config = { tools: { codeMode: { languages: ["javascript"], runtime: "quickjs-wasi" } },
      agents: { entries: { writer: { tools: { codeMode: { languages: ["javascript"], runtime: "quickjs-wasi" } } } } } } as unknown as OpenClawConfig;
    const checks = auditLegacyConfigKeys(config).map((r) => r.check);
    for (const check of ["tools.codeMode.languages", "tools.codeMode.runtime",
      "agents.entries.writer.tools.codeMode.languages", "agents.entries.writer.tools.codeMode.runtime"]) {
      expect(checks).toContain(check);
    }
    expect(auditLegacyConfigKeys({ tools: { codeMode: { executor: "quickjs" } } } as unknown as OpenClawConfig)).toHaveLength(0);
  });

  it("flags retired Tool Search code mode and timeout", () => {
    const config = { tools: { toolSearch: { mode: "code", codeTimeoutMs: 1000 } } } as unknown as OpenClawConfig;
    const checks = auditLegacyConfigKeys(config).map((r) => r.check);
    expect(checks).toContain("tools.toolSearch.mode");
    expect(checks).toContain("tools.toolSearch.codeTimeoutMs");
    expect(auditLegacyConfigKeys({ tools: { toolSearch: { mode: "tools" } } } as unknown as OpenClawConfig)).toHaveLength(0);
  });

  it("flags the retired Copilot discovery switch", () => {
    const config = { plugins: { entries: { "github-copilot": { config: { discovery: { enabled: false } } } } } } as unknown as OpenClawConfig;
    const result = auditLegacyConfigKeys(config).find((r) => r.check === "plugins.entries.github-copilot.config.discovery.enabled");
    expect(result?.message).toContain("agents.defaults.modelPolicy.allow");
    const emptyBlock = { plugins: { entries: { "github-copilot": { config: { discovery: {} } } } } } as unknown as OpenClawConfig;
    expect(auditLegacyConfigKeys(emptyBlock).some((r) => r.check === "plugins.entries.github-copilot.config.discovery")).toBe(true);
  });

  it("flags per-agent Code Mode keys on an agents.list roster", () => {
    const config = { agents: { list: [{ id: "a", tools: { codeMode: { languages: ["javascript"], runtime: "quickjs-wasi" } } }] } } as unknown as OpenClawConfig;
    const checks = auditLegacyConfigKeys(config).map((r) => r.check);
    expect(checks).toContain("agents.list[0].tools.codeMode.languages");
    expect(checks).toContain("agents.list[0].tools.codeMode.runtime");
  });

  it("flags removed direct and internal silent reply scopes on surfaces", () => {
    const config = { surfaces: { slack: { silentReply: { direct: true, internal: true, group: true } } } } as unknown as OpenClawConfig;
    const results = auditLegacyConfigKeys(config);
    expect(results.map((r) => r.check).sort()).toEqual(["surfaces.slack.silentReply.direct", "surfaces.slack.silentReply.internal"]);
    expect(results.every((r) => r.message.includes("only channel groups may use NO_REPLY"))).toBe(true);
  });

  it("flags newly retired internal silent reply scopes", () => {
    const config = { agents: { defaults: { silentReply: { internal: true } } },
      surfaces: { telegram: { silentReply: { internal: false } } } } as unknown as OpenClawConfig;
    const checks = auditLegacyConfigKeys(config).map((r) => r.check);
    for (const check of ["agents.defaults.silentReply.internal", "surfaces.telegram.silentReply.internal"]) {
      expect(checks).toContain(check);
    }
  });

  it("flags doctor-repairable tool policy allow/alsoAllow conflicts", () => {
    const config = { tools: { allow: ["read"], alsoAllow: ["write"] } } as unknown as OpenClawConfig;
    const result = auditLegacyConfigKeys(config).find((r) => r.check === "tools.allow/alsoAllow");
    expect(result?.status).toBe("warn");
    expect(result?.message).toContain("review the permission policy");
    expect(auditLegacyConfigKeys({ tools: { allow: ["read"], alsoAllow: [] } } as unknown as OpenClawConfig)).toHaveLength(0);
  });

  it("every 2026.9.8 finding is a warn pointing at doctor --fix", () => {
    const config = { tools: { codeMode: { languages: [], runtime: "quickjs-wasi" },
      toolSearch: { mode: "code", codeTimeoutMs: 100 } },
      plugins: { entries: { "github-copilot": { config: { discovery: { enabled: true } } } } },
      agents: { defaults: { silentReply: { internal: true } },
        entries: { writer: { tools: { codeMode: { languages: [], runtime: "quickjs-wasi" } } } } },
      surfaces: { telegram: { silentReply: { internal: true } } } } as unknown as OpenClawConfig;
    const results = auditLegacyConfigKeys(config);
    expect(results.length).toBeGreaterThanOrEqual(9);
    expect(results.every((r) => r.status === "warn" && r.category === "Legacy Config")).toBe(true);
    expect(results.every((r) => r.fix?.includes("openclaw doctor --fix"))).toBe(true);
  });
});
