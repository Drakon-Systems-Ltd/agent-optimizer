import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, appendFileSync } from "fs";
import { dirname } from "path";
import { homedir } from "os";
import { resolve } from "path";
import type { MonitorState } from "../types.js";

export const MONITOR_DIR = resolve(homedir(), ".agent-optimizer");
export const MONITOR_STATE_PATH = resolve(MONITOR_DIR, "monitor.json");
export const MONITOR_LOG_PATH = resolve(MONITOR_DIR, "monitor.log");

export const DEFAULT_API_BASE =
  process.env.AGENT_OPTIMIZER_API_BASE ?? "https://drakonsystems.com";

export function loadMonitorState(): MonitorState | null {
  if (!existsSync(MONITOR_STATE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(MONITOR_STATE_PATH, "utf-8")) as MonitorState;
  } catch {
    return null;
  }
}

export function saveMonitorState(state: MonitorState): void {
  mkdirSync(dirname(MONITOR_STATE_PATH), { recursive: true });
  writeFileSync(MONITOR_STATE_PATH, JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
}

export function clearMonitorState(): boolean {
  if (!existsSync(MONITOR_STATE_PATH)) return false;
  unlinkSync(MONITOR_STATE_PATH);
  return true;
}

export function appendMonitorLog(message: string): void {
  try {
    mkdirSync(dirname(MONITOR_LOG_PATH), { recursive: true });
    const line = `[${new Date().toISOString()}] ${message}\n`;
    appendFileSync(MONITOR_LOG_PATH, line);
  } catch {
    // Swallow — logging must never crash the monitor
  }
}
