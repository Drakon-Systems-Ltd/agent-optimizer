export interface AuditResult {
  category: string;
  check: string;
  status: "pass" | "warn" | "fail" | "info";
  message: string;
  fix?: string;
  autoFixable?: boolean;
}

export interface AuditReport {
  timestamp: string;
  host: string;
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
  gateway?: Record<string, unknown>;
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
}

export interface AuditOptions {
  config: string;
  agentDir?: string;
  json?: boolean;
  fix?: boolean;
  deep?: boolean;
}
