import ora from "ora";
import chalk from "chalk";
import type { AuditOptions, AuditReport, AuditResult } from "../types.js";
import { loadConfig, findAgentDir, detectOpenClawVersion } from "../utils/config.js";
import { auditModelConfig } from "./model-config.js";
import { auditAuthProfiles } from "./auth-profiles.js";
import { auditTokenEfficiency } from "./token-efficiency.js";
import { auditPlugins } from "./plugins.js";
import { auditLegacyOverrides } from "./legacy-overrides.js";
import { auditToolPermissions } from "./tool-permissions.js";
import { auditCostEstimate } from "./cost-estimator.js";
import { auditCacheEfficiency } from "./cache-efficiency.js";
import { auditBootstrapFiles } from "./bootstrap-files.js";
import { auditChannelSecurity } from "./channel-security.js";
import { auditProviderFailover } from "./provider-failover.js";
import { auditMemorySearch } from "./memory-search.js";
import { auditLocalModels } from "./local-models.js";
import { auditHooksDeprecations } from "./hooks-deprecations.js";
import { auditHookEvents } from "./hook-events.js";
import { auditSecurityAdvisories } from "./security-advisories.js";
import { auditConfigPatchUsage } from "./config-patch-usage.js";
import { auditDreamingCron } from "./dreaming-cron.js";
import { auditPairingCidrs } from "./pairing-cidrs.js";
import { auditSandboxBackends } from "./sandbox-backends.js";
import { auditExecApprovals } from "./exec-approvals.js";
import { auditToolsByProvider } from "./tools-by-provider.js";

interface AuditorModule {
  name: string;
  run: () => AuditResult[];
}

export async function runFullAudit(opts: AuditOptions & { silent?: boolean }): Promise<AuditReport> {
  const config = loadConfig(opts.config);
  if (!config) {
    console.error(`Config not found: ${opts.config}`);
    process.exit(1);
  }

  const agentDir = opts.agentDir ?? findAgentDir(config);
  const showProgress = !opts.json && !opts.silent;

  // Detect version with spinner
  let openclawVersion = "unknown";
  if (showProgress) {
    const vSpinner = ora({ text: chalk.dim("Detecting OpenClaw version..."), color: "red" }).start();
    openclawVersion = detectOpenClawVersion() ?? "unknown";
    if (openclawVersion !== "unknown") {
      vSpinner.succeed(chalk.dim(`OpenClaw ${openclawVersion}`));
    } else {
      vSpinner.info(chalk.dim("OpenClaw version not detected"));
    }
  } else {
    openclawVersion = detectOpenClawVersion() ?? "unknown";
  }

  // Define all auditor modules
  const auditors: AuditorModule[] = [
    { name: "Model Config", run: () => auditModelConfig(config) },
    { name: "Auth Profiles", run: () => auditAuthProfiles(config, agentDir) },
    { name: "Cost Estimator", run: () => auditCostEstimate(config, agentDir) },
    { name: "Token Efficiency", run: () => auditTokenEfficiency(config) },
    { name: "Cache Efficiency", run: () => auditCacheEfficiency(config) },
    { name: "Bootstrap Files", run: () => auditBootstrapFiles(config) },
    { name: "Plugins", run: () => auditPlugins(config) },
    { name: "Legacy Overrides", run: () => auditLegacyOverrides(config, agentDir) },
    { name: "Tool Permissions", run: () => auditToolPermissions(config) },
    { name: "Provider Failover", run: () => auditProviderFailover(config, agentDir) },
    { name: "Channel Security", run: () => auditChannelSecurity(config) },
    { name: "Memory Search", run: () => auditMemorySearch(config) },
    { name: "Local Models", run: () => auditLocalModels(config) },
    { name: "Hooks Deprecations", run: () => auditHooksDeprecations(config) },
    { name: "Hook Events", run: () => auditHookEvents(config) },
    { name: "Config Patch Usage", run: () => auditConfigPatchUsage(config) },
    { name: "Dreaming Cron", run: () => auditDreamingCron(config) },
    { name: "Pairing CIDRs", run: () => auditPairingCidrs(config) },
    { name: "Sandbox Backends", run: () => auditSandboxBackends(config) },
    { name: "Exec Approvals", run: () => auditExecApprovals() },
    { name: "Tools / byProvider", run: () => auditToolsByProvider(config) },
    { name: "Security Advisories", run: () => auditSecurityAdvisories(openclawVersion) },
  ];

  const results: AuditResult[] = [];
  let spinner: ReturnType<typeof ora> | null = null;

  if (showProgress) {
    spinner = ora({ color: "red", spinner: "dots" }).start();
  }

  for (let i = 0; i < auditors.length; i++) {
    const auditor = auditors[i];
    if (spinner) {
      spinner.text = chalk.dim(`Scanning ${auditor.name}... (${i + 1}/${auditors.length})`);
    }
    results.push(...auditor.run());
  }

  if (spinner) {
    spinner.succeed(chalk.dim(`${auditors.length} modules scanned · ${results.length} checks`));
  }

  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === "pass").length,
    warn: results.filter((r) => r.status === "warn").length,
    fail: results.filter((r) => r.status === "fail").length,
  };

  return {
    timestamp: new Date().toISOString(),
    host: "localhost",
    openclawVersion,
    results,
    summary,
  };
}
