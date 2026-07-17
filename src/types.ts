export interface AuditResult {
  category: string;
  check: string;
  status: "pass" | "warn" | "fail" | "info";
  message: string;
  fix?: string;
  autoFixable?: boolean;
  system?: SystemKind;
  // Concrete machine-applicable transformation(s) for `audit --fix`. Present only
  // on autoFixable findings whose fix is unambiguous. Without this, a finding may
  // be flagged autoFixable but is left for manual action.
  apply?: FixOperation[];
}

// A single deterministic edit applied to a target config file by `audit --fix`.
// Array edits are value-based (arrayRemove / arrayReplace) rather than positional
// so they stay correct when multiple fixes touch the same array.
export interface FixOperation {
  // Which file the path is rooted in: the openclaw.json passed via -c, or the
  // models.json resolved from the agent directory.
  target: "config" | "models";
  op: "set" | "delete" | "arrayRemove" | "arrayReplace";
  path: string; // dot-path within the target file; numeric segments index arrays
  value?: unknown; // for "set" (new value) and "arrayReplace" (replacement item)
  remove?: unknown[]; // for "arrayRemove" (items to drop from the array at path)
  match?: unknown; // for "arrayReplace" (array items equal to this become `value`)
}

export interface AuditReport {
  timestamp: string;
  host: string;
  systems: DetectedSystem[];
  openclawVersion: string;
  results: AuditResult[];
  summary: {
    total: number;
    pass: number;
    warn: number;
    fail: number;
  };
}

export interface OpenClawConfig {
  agents?: {
    defaults?: AgentDefaults;
    list?: AgentEntry[];
  };
  plugins?: {
    allow?: string[];
    entries?: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>;
    installs?: Record<string, PluginInstall>;
    // Context-engine / memory plugin slots (v2026.5+). lossless-claw compaction
    // migrates here from agents.defaults.compaction.provider.
    slots?: {
      memory?: string;
      contextEngine?: string;
    };
  };
  hooks?: {
    internal?: {
      enabled?: boolean;
      handlers?: Array<{ event?: string; module?: string }>; // legacy
      entries?: Record<string, {
        enabled?: boolean;
        event?: string;
        env?: Record<string, string>;
      }>;
      load?: { extraDirs?: string[] };
    };
  };
  gateway?: Record<string, unknown>;
  channels?: Record<string, unknown>;
  tools?: {
    profile?: "minimal" | "coding" | "messaging" | "full";
    // Legacy location: sandbox backend/ssh config moved to agents.defaults.sandbox
    // (AgentSandboxSchema). tools.sandbox now only carries a tool policy.
    sandbox?: {
      tools?: Record<string, unknown>;
      backend?: string;
      mode?: string;
      ssh?: {
        host?: string;
        keyPath?: string;
        certPath?: string;
        knownHostsPath?: string;
      };
    };
    byProvider?: Record<string, {
      profile?: string;
      allow?: string[];
      deny?: string[];
    }>;
    // Media-understanding model overrides (v2026.5+). Per-kind entries take
    // precedence over shared tools.media.models.
    media?: {
      models?: MediaModelRef[];
      image?: { enabled?: boolean; models?: MediaModelRef[] };
      audio?: { enabled?: boolean; models?: MediaModelRef[] };
      video?: { enabled?: boolean; models?: MediaModelRef[] };
    };
  };
  [key: string]: unknown;
}

export interface AgentDefaults {
  model?: {
    primary?: string;
    fallbacks?: string[];
  };
  models?: Record<string, ModelConfig>;
  workspace?: string;
  contextTokens?: number;
  contextPruning?: {
    mode?: string;
    ttl?: string;
    keepLastAssistants?: number;
  };
  compaction?: {
    mode?: string;
    model?: string;
    // Legacy context-engine selector (e.g. "lossless-claw"); deprecated in
    // favour of plugins.slots.contextEngine. Free-form string, still parses.
    provider?: string;
    reserveTokensFloor?: number;
    maxHistoryShare?: number;
    identifierPolicy?: string;
    memoryFlush?: {
      enabled?: boolean;
      softThresholdTokens?: number;
      prompt?: string;
      systemPrompt?: string;
    };
  };
  heartbeat?: {
    every?: string;
    lightContext?: boolean;
    isolatedSession?: boolean;
  };
  maxConcurrent?: number;
  subagents?: {
    maxConcurrent?: number;
  };
  thinkingDefault?: string;
  imageMaxDimensionPx?: number;
  bootstrapMaxChars?: number;
  bootstrapTotalMaxChars?: number;
  // Vision model for image understanding (v2026.5+). When unset, falls back to
  // the active/primary model — only used when the primary can't accept images.
  imageModel?: AgentModelRef;
  // Embedded-runner retry ceiling (v2026.5+). Object, NOT a scalar. Zod-strict
  // with cross-field max>=min. Applies to the embedded runtime only (not ACP/CLI).
  runRetries?: {
    base?: number;
    perProfile?: number;
    min?: number;
    max?: number;
  };
  // Agent-level sandbox config (AgentSandboxSchema). Backend is a free string —
  // "docker" and "ssh" are the bundled backends; plugins can register others.
  sandbox?: SandboxConfig;
}

export interface SandboxConfig {
  mode?: string; // off | non-main | all
  backend?: string;
  workspaceAccess?: string; // none | ro | rw
  scope?: string; // session | agent | shared
  workspaceRoot?: string;
  ssh?: {
    target?: string;
    command?: string;
    identityFile?: string;
    certificateFile?: string;
    knownHostsFile?: string;
    strictHostKeyChecking?: boolean;
  };
  docker?: Record<string, unknown>;
}

// A model reference: bare "provider/model" string, or an object form.
export type AgentModelRef =
  | string
  | { primary?: string; fallbacks?: string[]; timeoutMs?: number };

// A media-understanding model entry (tools.media.*.models[]). Loosely typed —
// OpenClaw's schema is strict but we only read provider/model for validation.
export interface MediaModelRef {
  provider?: string;
  model?: string;
  capabilities?: unknown;
  type?: string;
  [key: string]: unknown;
}

export interface AgentEntry {
  id: string;
  name: string;
  workspace: string;
  agentDir: string;
  tools?: {
    alsoAllow?: string[];
    deny?: string[];
    elevated?: {
      allowFrom?: Record<string, string[]>;
    };
  };
  sandbox?: SandboxConfig;
}

export interface ModelConfig {
  alias?: string;
  params?: Record<string, unknown>;
}

export interface PluginInstall {
  source: string;
  spec?: string;
  installPath: string;
  version: string;
  resolvedName?: string;
  installedAt?: string;
}

export interface AuthProfile {
  type: string;
  provider: string;
  token?: string;
  key?: string;
  access?: string;
  refresh?: string;
  expires?: number;
  email?: string;
}

export interface AuthProfiles {
  version: number;
  profiles: Record<string, AuthProfile>;
  order?: Record<string, string[]>;
  lastGood?: Record<string, string>;
}

export interface OptimizeOptions {
  config: string;
  dryRun?: boolean;
  profile: "minimal" | "balanced" | "aggressive";
  only?: string[];
  skip?: string[];
  /** Target system. Auto-detected via detectSystems() when omitted. */
  system?: "claude-code" | "openclaw";
}

export interface AuditOptions {
  config: string;
  agentDir?: string;
  json?: boolean;
  fix?: boolean;
  deep?: boolean;
}

export interface MonitorState {
  token: string;
  email: string;
  agentName: string;
  enrolledAt: string;
  apiBase: string;
}

export interface MonitorPingPayload {
  token: string;
  timestamp: string;
  openclawVersion: string;
  healthScore: number;
  summary: {
    pass: number;
    warn: number;
    fail: number;
    info: number;
    total: number;
  };
  issues: Array<{
    category: string;
    check: string;
    status: "pass" | "warn" | "fail" | "info";
  }>;
}

export type SystemKind = "claude-code" | "openclaw" | "cursor";

export interface DetectedSystem {
  kind: SystemKind;
  version: string | null;
  configPath: string;
  scope: "user" | "project";
}
