import ora from "ora";
import chalk from "chalk";
import type { AuditResult, OpenClawConfig } from "../../types.js";
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

export interface OpenClawRunnerOpts {
  config: OpenClawConfig;
  agentDir: string;
  openclawVersion: string;
  showProgress: boolean;
}

export function runOpenClawAuditors(opts: OpenClawRunnerOpts): AuditResult[] {
  const { config, agentDir, openclawVersion, showProgress } = opts;

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
    results.push(...auditor.run().map((r) => ({ ...r, system: "openclaw" as const })));
  }

  if (spinner) {
    spinner.succeed(chalk.dim(`${auditors.length} OpenClaw modules scanned · ${results.length} checks`));
  }

  return results;
}
