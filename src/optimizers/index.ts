import chalk from "chalk";
import type { OptimizeOptions, OpenClawConfig } from "../types.js";
import { loadConfig, expandPath } from "../utils/config.js";
import { writeFileSync, copyFileSync } from "fs";

export interface Optimization {
  tag: string;
  path: string;
  current: unknown;
  recommended: unknown;
  reason: string;
  /** Suggestion-only — printed in dry-run, filtered out of the apply loop. */
  info?: true;
}

export const OPTIMIZATION_TAGS = [
  "context",
  "heartbeat",
  "subagents",
  "compaction",
  "pruning",
  "image-max-dim",
  "bootstrap-max-chars",
  "bootstrap-total-max-chars",
  "isolated-cron",
  "cache-ttl-pruning",
  "fallback-chain",
  "channel-history-limit",
  "channel-media-max",
  "channel-text-chunk",
  "discord-idle-hours",
  "channel-model-routing",
  "tools-profile",
] as const;

export type OptimizationTag = (typeof OPTIMIZATION_TAGS)[number];

interface ProfileTargets {
  contextTokens: number;
  heartbeat: string;
  subagents: number;
  pruningTtl: string;
  imageMaxDim: number;
  bootstrapMax: number;
  bootstrapTotal: number;
  fallbackMin: number;
  channelHistoryLimit: number;
  channelMediaMax: number;
  channelTextChunk: number;
  discordIdleHours: number;
  toolsProfile: "minimal" | "coding" | "default" | "full";
}

const PROFILES: Record<string, ProfileTargets> = {
  minimal: {
    contextTokens: 500000,
    heartbeat: "4h",
    subagents: 6,
    pruningTtl: "1h",
    imageMaxDim: 2000,
    bootstrapMax: 100000,
    bootstrapTotal: 200000,
    fallbackMin: 1,
    channelHistoryLimit: 100,
    channelMediaMax: 100,
    channelTextChunk: 4000,
    discordIdleHours: 48,
    toolsProfile: "full",
  },
  balanced: {
    contextTokens: 200000,
    heartbeat: "6h",
    subagents: 4,
    pruningTtl: "2h",
    imageMaxDim: 1200,
    bootstrapMax: 20000,
    bootstrapTotal: 150000,
    fallbackMin: 2,
    channelHistoryLimit: 50,
    channelMediaMax: 20,
    channelTextChunk: 4000,
    discordIdleHours: 24,
    toolsProfile: "coding",
  },
  aggressive: {
    contextTokens: 100000,
    heartbeat: "12h",
    subagents: 2,
    pruningTtl: "30m",
    imageMaxDim: 800,
    bootstrapMax: 10000,
    bootstrapTotal: 100000,
    fallbackMin: 3,
    channelHistoryLimit: 20,
    channelMediaMax: 5,
    channelTextChunk: 2000,
    discordIdleHours: 8,
    toolsProfile: "minimal",
  },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Compute the list of optimizations for a given config + profile.
 * Exported for testability.
 */
export function getOptimizations(
  config: OpenClawConfig,
  profile: string
): Optimization[] {
  const opts: Optimization[] = [];
  const target = PROFILES[profile] ?? PROFILES.balanced;
  const defaults = config.agents?.defaults;

  // ── Existing 5 dimensions ──────────────────────────────────────────
  if (defaults) {
    // Context tokens
    const currentContext = defaults.contextTokens ?? 200000;
    if (currentContext > target.contextTokens) {
      opts.push({
        tag: "context",
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
        tag: "heartbeat",
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
        tag: "subagents",
        path: "agents.defaults.subagents.maxConcurrent",
        current: currentSub,
        recommended: target.subagents,
        reason: `Reduce subagent concurrency from ${currentSub} to ${target.subagents}`,
      });
    }

    // Compaction
    if (!defaults.compaction?.mode) {
      opts.push({
        tag: "compaction",
        path: "agents.defaults.compaction.mode",
        current: "none",
        recommended: "safeguard",
        reason: "Enable compaction to prevent unbounded history growth",
      });
    }

    // Context pruning (legacy — when totally unset)
    if (!defaults.contextPruning?.mode) {
      opts.push({
        tag: "pruning",
        path: "agents.defaults.contextPruning",
        current: "none",
        recommended: { mode: "cache-ttl", ttl: target.pruningTtl },
        reason: "Enable context pruning to reduce stale context",
      });
    }
  }

  // ── New dimensions ─────────────────────────────────────────────────
  const defaultsRaw = (config.agents?.defaults ?? {}) as Record<string, unknown>;

  // image-max-dim
  {
    const cur = defaultsRaw.imageMaxDimensionPx;
    const isNum = typeof cur === "number";
    const exceeds = isNum && (cur as number) > target.imageMaxDim;
    const missingButBudgeted = !isNum && profile !== "minimal";
    if (exceeds || missingButBudgeted) {
      opts.push({
        tag: "image-max-dim",
        path: "agents.defaults.imageMaxDimensionPx",
        current: cur ?? "unset",
        recommended: target.imageMaxDim,
        reason: exceeds
          ? `Cap image dimension at ${target.imageMaxDim}px (was ${cur}px) — saves vision tokens`
          : `Set image dimension cap to ${target.imageMaxDim}px to bound vision-token cost`,
      });
    }
  }

  // bootstrap-max-chars
  {
    const cur = defaultsRaw.bootstrapMaxChars;
    const isNum = typeof cur === "number";
    const exceeds = isNum && (cur as number) > target.bootstrapMax;
    const missingButBudgeted = !isNum && profile !== "minimal";
    if (exceeds || missingButBudgeted) {
      opts.push({
        tag: "bootstrap-max-chars",
        path: "agents.defaults.bootstrapMaxChars",
        current: cur ?? "unset",
        recommended: target.bootstrapMax,
        reason: exceeds
          ? `Reduce per-file bootstrap cap from ${cur} to ${target.bootstrapMax} chars`
          : `Set per-file bootstrap cap to ${target.bootstrapMax} chars`,
      });
    }
  }

  // bootstrap-total-max-chars
  {
    const cur = defaultsRaw.bootstrapTotalMaxChars;
    const isNum = typeof cur === "number";
    const exceeds = isNum && (cur as number) > target.bootstrapTotal;
    const missingButBudgeted = !isNum && profile !== "minimal";
    if (exceeds || missingButBudgeted) {
      opts.push({
        tag: "bootstrap-total-max-chars",
        path: "agents.defaults.bootstrapTotalMaxChars",
        current: cur ?? "unset",
        recommended: target.bootstrapTotal,
        reason: exceeds
          ? `Reduce total bootstrap cap from ${cur} to ${target.bootstrapTotal} chars`
          : `Set total bootstrap cap to ${target.bootstrapTotal} chars`,
      });
    }
  }

  // isolated-cron (aggressive only)
  if (profile === "aggressive") {
    const heartbeat = defaultsRaw.heartbeat as Record<string, unknown> | undefined;
    const current = heartbeat?.isolatedSession;
    if (current !== true) {
      opts.push({
        tag: "isolated-cron",
        path: "agents.defaults.heartbeat.isolatedSession",
        current: current ?? false,
        recommended: true,
        reason: "Run scheduled (cron) heartbeats in isolated sessions to keep them off the live context",
      });
    }
  }

  // cache-ttl-pruning (balanced / aggressive, only if mode is unset)
  if (profile === "balanced" || profile === "aggressive") {
    if (!defaults?.contextPruning?.mode) {
      opts.push({
        tag: "cache-ttl-pruning",
        path: "agents.defaults.contextPruning.mode",
        current: defaults?.contextPruning?.mode ?? "unset",
        recommended: "cache-ttl",
        reason: "Use cache-ttl pruning mode to expire stale context based on cache TTL",
      });
    }
  }

  // fallback-chain (info-only)
  {
    const model = defaults?.model;
    const fallbacks = Array.isArray(model?.fallbacks) ? (model!.fallbacks as string[]) : [];
    if (fallbacks.length < target.fallbackMin) {
      // Build a reasonable suggested array: keep existing entries, pad with primary or placeholders
      const padded = [...fallbacks];
      const primary = typeof model?.primary === "string" ? model.primary : "anthropic/claude-sonnet";
      while (padded.length < target.fallbackMin) {
        // suggest variants the user can edit — never duplicate exactly
        padded.push(`${primary}-fallback-${padded.length + 1}`);
      }
      opts.push({
        tag: "fallback-chain",
        path: "agents.defaults.model.fallbacks",
        current: fallbacks,
        recommended: padded,
        reason: `Suggestion: extend model fallback chain to at least ${target.fallbackMin} entries for resilience (info-only — pick real models)`,
        info: true,
      });
    }
  }

  // Per-channel dimensions
  const channels = config.channels ?? {};
  for (const [provider, raw] of Object.entries(channels)) {
    if (!isPlainObject(raw)) continue;
    const ch = raw;

    // channel-history-limit
    {
      const cur = ch.historyLimit;
      if (typeof cur === "number" && cur > target.channelHistoryLimit) {
        opts.push({
          tag: "channel-history-limit",
          path: `channels.${provider}.historyLimit`,
          current: cur,
          recommended: target.channelHistoryLimit,
          reason: `Reduce ${provider} history limit from ${cur} to ${target.channelHistoryLimit}`,
        });
      }
    }

    // channel-media-max
    {
      const cur = ch.mediaMaxMb;
      if (typeof cur === "number" && cur > target.channelMediaMax) {
        opts.push({
          tag: "channel-media-max",
          path: `channels.${provider}.mediaMaxMb`,
          current: cur,
          recommended: target.channelMediaMax,
          reason: `Cap ${provider} media size at ${target.channelMediaMax}MB (was ${cur}MB)`,
        });
      }
    }

    // channel-text-chunk
    {
      const cur = ch.textChunkLimit;
      if (typeof cur === "number" && cur > target.channelTextChunk) {
        opts.push({
          tag: "channel-text-chunk",
          path: `channels.${provider}.textChunkLimit`,
          current: cur,
          recommended: target.channelTextChunk,
          reason: `Reduce ${provider} text chunk limit from ${cur} to ${target.channelTextChunk}`,
        });
      }
    }
  }

  // discord-idle-hours
  {
    const discord = channels.discord;
    if (isPlainObject(discord)) {
      const tb = discord.threadBindings;
      if (isPlainObject(tb)) {
        const cur = tb.idleHours;
        if (typeof cur === "number" && cur > target.discordIdleHours) {
          opts.push({
            tag: "discord-idle-hours",
            path: "channels.discord.threadBindings.idleHours",
            current: cur,
            recommended: target.discordIdleHours,
            reason: `Reduce Discord thread idle window from ${cur}h to ${target.discordIdleHours}h`,
          });
        }
      }
    }
  }

  // channel-model-routing (aggressive only, info-only)
  if (profile === "aggressive") {
    const rawConfig = config as Record<string, unknown>;
    const channelsRaw = (rawConfig.channels ?? {}) as Record<string, unknown>;
    const routing = channelsRaw.modelByChannel;
    const isEmpty =
      routing === undefined ||
      routing === null ||
      (isPlainObject(routing) && Object.keys(routing).length === 0);
    if (isEmpty) {
      const detected = Object.keys(channels).filter((k) => isPlainObject(channels[k]));
      if (detected.length > 0) {
        const sample: Record<string, string> = {};
        for (const provider of detected) {
          // Discord defaults to fast/cheap; others to mid-tier
          sample[provider] =
            provider === "discord" || provider === "telegram" ? "haiku" : "sonnet";
        }
        opts.push({
          tag: "channel-model-routing",
          path: "channels.modelByChannel",
          current: routing ?? "unset",
          recommended: sample,
          reason: `Suggestion: route high-volume channels to cheaper models (detected: ${detected.join(", ")}). Info-only — edit to taste`,
          info: true,
        });
      }
    }
  }

  // tools-profile
  {
    const toolsCur = (config.tools?.profile ?? "default") as string;
    if (toolsCur !== target.toolsProfile) {
      opts.push({
        tag: "tools-profile",
        path: "tools.profile",
        current: config.tools?.profile ?? "default",
        recommended: target.toolsProfile,
        reason: `Switch tools profile from "${toolsCur}" to "${target.toolsProfile}"`,
      });
    }
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

  let optimizations = getOptimizations(config, opts.profile);

  // Filter by --only or --skip
  if (opts.only && opts.only.length > 0) {
    const tags = opts.only;
    optimizations = optimizations.filter((o) => tags.includes(o.tag));
  } else if (opts.skip && opts.skip.length > 0) {
    const tags = opts.skip;
    optimizations = optimizations.filter((o) => !tags.includes(o.tag));
  }

  if (optimizations.length === 0) {
    console.log(chalk.green("✓ No optimizations needed — config looks good"));
    if (opts.only || opts.skip) {
      console.log(chalk.dim(`  (filtered by ${opts.only ? "--only " + opts.only.join(",") : "--skip " + opts.skip!.join(",")})`));
      console.log(chalk.dim(`  Available tags: ${OPTIMIZATION_TAGS.join(", ")}`));
    }
    return;
  }

  console.log(
    chalk.bold(`Found ${optimizations.length} optimization(s) (profile: ${opts.profile}):\n`)
  );

  for (const opt of optimizations) {
    const prefix = opt.info ? chalk.cyan("info:") + " " : "";
    console.log(`  ${chalk.yellow("→")} ${prefix}[${chalk.dim(opt.tag)}] ${opt.reason}`);
    console.log(
      `    ${chalk.dim(`${opt.path}: ${JSON.stringify(opt.current)} → ${JSON.stringify(opt.recommended)}`)}`
    );
  }

  if (opts.dryRun) {
    console.log(chalk.dim("\n--dry-run: no changes applied"));
    console.log(chalk.dim(`Available tags for --only/--skip: ${OPTIMIZATION_TAGS.join(", ")}`));
    return;
  }

  // Backup
  const configPath = expandPath(opts.config);
  const backupPath = `${configPath}.pre-optimize.bak`;
  copyFileSync(configPath, backupPath);
  console.log(chalk.dim(`\nBackup: ${backupPath}`));

  // Apply — info-only entries are suggestions, never auto-written
  const applicable = optimizations.filter((o) => !o.info);
  const skippedInfo = optimizations.length - applicable.length;

  for (const opt of applicable) {
    applyOptimization(config, opt);
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(chalk.green(`\n✓ Applied ${applicable.length} optimization(s)`));
  if (skippedInfo > 0) {
    console.log(chalk.dim(`  (${skippedInfo} info-only suggestion${skippedInfo === 1 ? "" : "s"} shown above — not auto-applied)`));
  }
  console.log(chalk.dim("Restart the gateway to apply: systemctl --user restart openclaw-gateway"));
  console.log(chalk.dim("Something wrong? Rollback with: agent-optimizer rollback"));
}
