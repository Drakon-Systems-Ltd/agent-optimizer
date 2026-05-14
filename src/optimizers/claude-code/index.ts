import chalk from "chalk";
import { existsSync, readFileSync, statSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import type { OptimizeOptions } from "../../types.js";
import type { Optimization } from "../index.js";

export const CC_OPTIMIZATION_TAGS = [
  "cc-allow-size",
  "cc-add-deny",
  "cc-broad-reads",
  "cc-memory-trim",
  "cc-hook-timeout-budget",
] as const;

export type CcOptimizationTag = (typeof CC_OPTIMIZATION_TAGS)[number];

export interface ClaudeCodeSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
    defaultMode?: string;
  };
  hooks?: Record<
    string,
    Array<{
      matcher?: string;
      hooks?: Array<{ type?: string; command?: string; timeout?: number }>;
    }>
  >;
  [key: string]: unknown;
}

interface CcProfileTargets {
  allowMaxCount: number;
  memoryMaxChars: number;
  broadReadsMax: number;
}

const CC_PROFILES: Record<string, CcProfileTargets> = {
  minimal: { allowMaxCount: 300, memoryMaxChars: 60_000, broadReadsMax: 3 },
  balanced: { allowMaxCount: 150, memoryMaxChars: 40_000, broadReadsMax: 1 },
  aggressive: { allowMaxCount: 100, memoryMaxChars: 20_000, broadReadsMax: 0 },
};

// Hot-path hook events — these run on every prompt or every tool call.
// Slow hooks here block the user-visible turn loop.
const HOT_PATH_HOOK_EVENTS = new Set(["UserPromptSubmit", "PreToolUse", "PostToolUse"]);

const HOT_PATH_TIMEOUT_S = 10;

/**
 * Heuristic: a `Read(//Users/...)` or `Read(/Users/...)` entry is "broad" when
 * it does NOT end with `/**` AND does NOT end with a file extension. Mirrors the
 * heuristic in src/auditors/claude-code/settings-permissions.ts.
 */
export function isBroadRead(entry: string): boolean {
  const m = entry.match(/^Read\((\/\/?Users\/[^)]+)\)$/);
  if (!m) return false;
  const inner = m[1];
  const looksRestricted = /\/\*\*$/.test(inner) || /\.[a-zA-Z0-9]+$/.test(inner);
  return !looksRestricted;
}

/**
 * Compute Claude Code optimization recommendations for a given settings file
 * and memory file size. All entries are info-only — apply is not supported in
 * v0.11.0 (settings.json edits need per-change review).
 */
export function getClaudeCodeOptimizations(
  settings: ClaudeCodeSettings,
  memoryChars: number,
  profile: "minimal" | "balanced" | "aggressive",
): Optimization[] {
  const target = CC_PROFILES[profile] ?? CC_PROFILES.balanced;
  const out: Optimization[] = [];
  const perms = settings.permissions ?? {};
  const allow = Array.isArray(perms.allow) ? perms.allow : [];
  const deny = perms.deny;

  // cc-allow-size — allow list is over budget
  if (allow.length > target.allowMaxCount) {
    out.push({
      tag: "cc-allow-size",
      path: "permissions.allow",
      current: allow.length,
      recommended: target.allowMaxCount,
      reason: `Allow list has ${allow.length} entries (>${target.allowMaxCount} for ${profile}) — long allow lists are hard to review. Prune unused or duplicate entries.`,
      info: true,
    });
  }

  // cc-add-deny — deny missing or empty
  if (!Array.isArray(deny) || deny.length === 0) {
    out.push({
      tag: "cc-add-deny",
      path: "permissions.deny",
      current: deny ?? "unset",
      recommended: ["Bash(rm:*)", "Bash(sudo:*)", "Bash(curl:*)"],
      reason:
        "No deny list configured — add a minimal denylist for high-risk commands (rm, sudo, curl). Defence-in-depth even if allow list is tight.",
      info: true,
    });
  }

  // cc-broad-reads — count broad Read(//Users/...) entries
  const broadReads = allow.filter(isBroadRead);
  if (broadReads.length > target.broadReadsMax) {
    out.push({
      tag: "cc-broad-reads",
      path: "permissions.allow",
      current: broadReads.length,
      recommended: `≤ ${target.broadReadsMax}`,
      reason: `${broadReads.length} broad Read(//Users/...) entr${broadReads.length === 1 ? "y" : "ies"} (>${target.broadReadsMax} for ${profile}) — tighten to specific paths or add /** suffix.`,
      info: true,
    });
  }

  // cc-memory-trim — CLAUDE.md too large
  if (memoryChars > target.memoryMaxChars) {
    out.push({
      tag: "cc-memory-trim",
      path: "~/.claude/CLAUDE.md",
      current: memoryChars,
      recommended: target.memoryMaxChars,
      reason: `CLAUDE.md is ${memoryChars.toLocaleString()} chars (>${target.memoryMaxChars.toLocaleString()} for ${profile}) — every turn pays this token cost. Trim to essentials or move detail into project-scoped memory.`,
      info: true,
    });
  }

  // cc-hook-timeout-budget — hot-path hooks with high timeouts
  const hooks = settings.hooks ?? {};
  for (const event of Object.keys(hooks)) {
    if (!HOT_PATH_HOOK_EVENTS.has(event)) continue;
    const entries = hooks[event] ?? [];
    for (const entry of entries) {
      for (const h of entry.hooks ?? []) {
        if (typeof h.timeout === "number" && h.timeout > HOT_PATH_TIMEOUT_S) {
          out.push({
            tag: "cc-hook-timeout-budget",
            path: `hooks.${event}`,
            current: `timeout=${h.timeout}s`,
            recommended: "≤ 5s",
            reason: `Hook on ${event} has timeout=${h.timeout}s — keep hot-path hooks under 5s. Command: ${h.command ?? "<unset>"}`,
            info: true,
          });
        }
      }
    }
  }

  return out;
}

/**
 * Read ~/.claude/settings.json (or project .claude/settings.json) and the
 * memory file, then print recommendations. ALWAYS dry-run for v0.11.0 — apply
 * is blocked.
 */
export async function runClaudeCodeOptimize(opts: OptimizeOptions): Promise<void> {
  // Resolve settings.json: if --config points at a settings.json, use it.
  // Otherwise default to ~/.claude/settings.json.
  let settingsPath = opts.config;
  const looksLikeSettings = settingsPath.endsWith("settings.json");
  if (!looksLikeSettings) {
    settingsPath = resolve(homedir(), ".claude", "settings.json");
  }

  let settings: ClaudeCodeSettings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as ClaudeCodeSettings;
    } catch (e) {
      console.error(chalk.red(`Could not parse ${settingsPath}: ${(e as Error).message}`));
      process.exit(1);
    }
  } else {
    console.log(
      chalk.yellow(
        `Claude Code settings.json not found at ${settingsPath} — running with empty config`,
      ),
    );
  }

  // Memory file — ~/.claude/CLAUDE.md
  const memoryPath = resolve(homedir(), ".claude", "CLAUDE.md");
  let memoryChars = 0;
  if (existsSync(memoryPath)) {
    try {
      memoryChars = statSync(memoryPath).size;
    } catch {
      memoryChars = 0;
    }
  }

  let optimizations = getClaudeCodeOptimizations(settings, memoryChars, opts.profile);

  // Filter by --only or --skip (operates on tag names)
  if (opts.only && opts.only.length > 0) {
    const tags = opts.only;
    optimizations = optimizations.filter((o) => tags.includes(o.tag));
  } else if (opts.skip && opts.skip.length > 0) {
    const tags = opts.skip;
    optimizations = optimizations.filter((o) => !tags.includes(o.tag));
  }

  console.log(chalk.bold("Claude Code optimization recommendations") + chalk.dim(` (profile: ${opts.profile})`));
  console.log(chalk.dim(`  settings: ${settingsPath}`));
  console.log(chalk.dim(`  memory:   ${memoryPath}${existsSync(memoryPath) ? ` (${memoryChars.toLocaleString()} chars)` : " (not present)"}\n`));

  if (optimizations.length === 0) {
    console.log(chalk.green("✓ No recommendations — Claude Code config looks good for this profile"));
    if (opts.only || opts.skip) {
      console.log(
        chalk.dim(
          `  (filtered by ${opts.only ? "--only " + opts.only.join(",") : "--skip " + opts.skip!.join(",")})`,
        ),
      );
      console.log(chalk.dim(`  Available tags: ${CC_OPTIMIZATION_TAGS.join(", ")}`));
    }
    return;
  }

  console.log(chalk.bold(`Found ${optimizations.length} recommendation(s):\n`));
  for (const opt of optimizations) {
    console.log(`  ${chalk.yellow("→")} ${chalk.cyan("info:")} [${chalk.dim(opt.tag)}] ${opt.reason}`);
    console.log(
      `    ${chalk.dim(`${opt.path}: ${JSON.stringify(opt.current)} → ${JSON.stringify(opt.recommended)}`)}`,
    );
  }

  console.log(
    chalk.dim(
      "\nClaude Code recommendations are info-only in v0.11.0 — apply is not supported (settings.json edits need per-change review).",
    ),
  );
  console.log(chalk.dim(`Available tags for --only/--skip: ${CC_OPTIMIZATION_TAGS.join(", ")}`));
}
