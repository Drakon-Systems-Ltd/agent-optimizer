import chalk from "chalk";
import type { OptimizeOptions, OpenClawConfig } from "../types.js";
import { loadConfig, expandPath } from "../utils/config.js";
import { writeFileSync, copyFileSync } from "fs";

interface Optimization {
  path: string;
  current: unknown;
  recommended: unknown;
  reason: string;
}

function getOptimizations(
  config: OpenClawConfig,
  profile: string
): Optimization[] {
  const opts: Optimization[] = [];
  const defaults = config.agents?.defaults;
  if (!defaults) return opts;

  const profiles: Record<string, {
    contextTokens: number;
    heartbeat: string;
    subagents: number;
    pruningTtl: string;
  }> = {
    minimal: { contextTokens: 500000, heartbeat: "4h", subagents: 6, pruningTtl: "1h" },
    balanced: { contextTokens: 200000, heartbeat: "6h", subagents: 4, pruningTtl: "2h" },
    aggressive: { contextTokens: 100000, heartbeat: "12h", subagents: 2, pruningTtl: "30m" },
  };

  const target = profiles[profile] ?? profiles.balanced;

  // Context tokens
  const currentContext = defaults.contextTokens ?? 200000;
  if (currentContext > target.contextTokens) {
    opts.push({
      path: "agents.defaults.contextTokens",
      current: currentContext,
      recommended: target.contextTokens,
      reason: `Reduce from ${(currentContext / 1000).toFixed(0)}K to ${(target.contextTokens / 1000).toFixed(0)}K — saves tokens per turn`,
    });
  }

  // Heartbeat
  const currentHeartbeat = defaults.heartbeat?.every ?? "1h";
  if (currentHeartbeat !== target.heartbeat) {
    opts.push({
      path: "agents.defaults.heartbeat.every",
      current: currentHeartbeat,
      recommended: target.heartbeat,
      reason: `Change heartbeat from ${currentHeartbeat} to ${target.heartbeat}`,
    });
  }

  // Subagents
  const currentSub = defaults.subagents?.maxConcurrent ?? 4;
  if (currentSub > target.subagents) {
    opts.push({
      path: "agents.defaults.subagents.maxConcurrent",
      current: currentSub,
      recommended: target.subagents,
      reason: `Reduce subagent concurrency from ${currentSub} to ${target.subagents}`,
    });
  }

  // Compaction
  if (!defaults.compaction?.mode) {
    opts.push({
      path: "agents.defaults.compaction.mode",
      current: "none",
      recommended: "safeguard",
      reason: "Enable compaction to prevent unbounded history growth",
    });
  }

  // Context pruning
  if (!defaults.contextPruning?.mode) {
    opts.push({
      path: "agents.defaults.contextPruning",
      current: "none",
      recommended: { mode: "cache-ttl", ttl: target.pruningTtl },
      reason: "Enable context pruning to reduce stale context",
    });
  }

  return opts;
}

function applyOptimization(config: OpenClawConfig, opt: Optimization): void {
  const parts = opt.path.split(".");
  let obj: Record<string, unknown> = config as Record<string, unknown>;

  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]] || typeof obj[parts[i]] !== "object") {
      obj[parts[i]] = {};
    }
    obj = obj[parts[i]] as Record<string, unknown>;
  }

  obj[parts[parts.length - 1]] = opt.recommended;
}

export async function runOptimize(opts: OptimizeOptions): Promise<void> {
  const config = loadConfig(opts.config);
  if (!config) {
    console.error(`Config not found: ${opts.config}`);
    process.exit(1);
  }

  const optimizations = getOptimizations(config, opts.profile);

  if (optimizations.length === 0) {
    console.log(chalk.green("✓ No optimizations needed — config looks good"));
    return;
  }

  console.log(
    chalk.bold(`Found ${optimizations.length} optimization(s) (profile: ${opts.profile}):\n`)
  );

  for (const opt of optimizations) {
    console.log(`  ${chalk.yellow("→")} ${opt.reason}`);
    console.log(
      `    ${chalk.dim(`${opt.path}: ${JSON.stringify(opt.current)} → ${JSON.stringify(opt.recommended)}`)}`
    );
  }

  if (opts.dryRun) {
    console.log(chalk.dim("\n--dry-run: no changes applied"));
    return;
  }

  // Backup
  const configPath = expandPath(opts.config);
  const backupPath = `${configPath}.pre-optimize.bak`;
  copyFileSync(configPath, backupPath);
  console.log(chalk.dim(`\nBackup: ${backupPath}`));

  // Apply
  for (const opt of optimizations) {
    applyOptimization(config, opt);
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(chalk.green(`\n✓ Applied ${optimizations.length} optimization(s)`));
  console.log(chalk.dim("Restart the gateway to apply: systemctl --user restart openclaw-gateway"));
}
