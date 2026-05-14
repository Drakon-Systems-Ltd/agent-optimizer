export interface AuditResult {
  category: string;
  check: string;
  status: "pass" | "warn" | "fail" | "info";
  message: string;
  fix?: string;
  autoFixable?: boolean;
  system?: SystemKind;
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
    profile?: "minimal" | "coding" | "default";
    sandbox?: {
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
  };
  maxConcurrent?: number;
  subagents?: {
    maxConcurrent?: number;
  };
  thinkingDefault?: string;
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
