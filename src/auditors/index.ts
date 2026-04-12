import type { AuditOptions, AuditReport, AuditResult } from "../types.js";
import { loadConfig, findAgentDir } from "../utils/config.js";
import { auditModelConfig } from "./model-config.js";
import { auditAuthProfiles } from "./auth-profiles.js";
import { auditTokenEfficiency } from "./token-efficiency.js";
import { auditPlugins } from "./plugins.js";
import { auditLegacyOverrides } from "./legacy-overrides.js";
import { auditToolPermissions } from "./tool-permissions.js";

export async function runFullAudit(opts: AuditOptions): Promise<AuditReport> {
  const config = loadConfig(opts.config);
  if (!config) {
    console.error(`Config not found: ${opts.config}`);
    process.exit(1);
  }

  const agentDir = opts.agentDir ?? findAgentDir(config);
  const results: AuditResult[] = [];

  results.push(...auditModelConfig(config));
  results.push(...auditAuthProfiles(config, agentDir));
  results.push(...auditTokenEfficiency(config));
  results.push(...auditPlugins(config));
  results.push(...auditLegacyOverrides(config, agentDir));
  results.push(...auditToolPermissions(config));

  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === "pass").length,
    warn: results.filter((r) => r.status === "warn").length,
    fail: results.filter((r) => r.status === "fail").length,
  };

  return {
    timestamp: new Date().toISOString(),
    host: "localhost",
    openclawVersion: "unknown",
    results,
    summary,
  };
}
