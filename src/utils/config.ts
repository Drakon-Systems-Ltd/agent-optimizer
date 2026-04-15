import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";
import { homedir } from "os";
import type { OpenClawConfig, AuthProfiles } from "../types.js";

export function expandPath(p: string): string {
  return p.replace(/^~/, homedir());
}

export function readJsonFile<T>(path: string): T | null {
  const resolved = expandPath(path);
  if (!existsSync(resolved)) return null;
  return JSON.parse(readFileSync(resolved, "utf-8")) as T;
}

export function loadConfig(configPath: string): OpenClawConfig | null {
  return readJsonFile<OpenClawConfig>(configPath);
}

export function loadAuthProfiles(agentDir: string): AuthProfiles | null {
  const path = resolve(expandPath(agentDir), "auth-profiles.json");
  return readJsonFile<AuthProfiles>(path);
}

export function loadModelsJson(agentDir: string): Record<string, unknown> | null {
  const path = resolve(expandPath(agentDir), "models.json");
  return readJsonFile<Record<string, unknown>>(path);
}

export function findAgentDir(config: OpenClawConfig): string {
  const list = config.agents?.list;
  if (list && list.length > 0 && list[0].agentDir) {
    return list[0].agentDir;
  }
  return "~/.openclaw/agents/main/agent";
}

export function findWorkspace(config: OpenClawConfig): string {
  const list = config.agents?.list;
  if (list && list.length > 0 && list[0].workspace) {
    return list[0].workspace;
  }
  return config.agents?.defaults?.workspace ?? "~/.openclaw/workspace";
}

/**
 * Detect OpenClaw version. Tries (in order):
 * 1. `openclaw --version` CLI output
 * 2. package.json in global npm install
 * Returns null if detection fails.
 */
export function detectOpenClawVersion(): string | null {
  // Try CLI
  try {
    const output = execSync("openclaw --version 2>/dev/null", {
      timeout: 5000,
      encoding: "utf-8",
    }).trim();
    // Output format varies: "2026.4.14" or "openclaw 2026.4.14"
    const match = output.match(/(\d{4}\.\d+\.\d+(?:-[\w.]+)?)/);
    if (match) return match[1];
  } catch {
    // CLI not available
  }

  // Try global npm package.json
  const candidates = [
    "/usr/lib/node_modules/openclaw/package.json",
    "/usr/local/lib/node_modules/openclaw/package.json",
    resolve(homedir(), ".npm-global/lib/node_modules/openclaw/package.json"),
    "/opt/homebrew/lib/node_modules/openclaw/package.json",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf-8"));
        if (pkg.version) return pkg.version;
      } catch {
        // Unreadable
      }
    }
  }

  return null;
}

/**
 * Parse a version string like "2026.4.14" into comparable parts.
 * Returns null if the version can't be parsed.
 */
export function parseVersion(version: string): { year: number; major: number; patch: number } | null {
  const match = version.match(/^(\d{4})\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    year: parseInt(match[1]),
    major: parseInt(match[2]),
    patch: parseInt(match[3]),
  };
}

/**
 * Returns true if `version` is older than `target`.
 */
export function isOlderThan(version: string, target: string): boolean {
  const v = parseVersion(version);
  const t = parseVersion(target);
  if (!v || !t) return false;
  if (v.year !== t.year) return v.year < t.year;
  if (v.major !== t.major) return v.major < t.major;
  return v.patch < t.patch;
}

export function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 0;
  const [, value, unit] = match;
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  return parseInt(value) * (multipliers[unit] ?? 0);
}
