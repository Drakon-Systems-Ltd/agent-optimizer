import { readFileSync, existsSync } from "fs";
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
