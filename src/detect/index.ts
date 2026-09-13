import { existsSync } from "fs";
import { execSync } from "child_process";
import { homedir } from "os";
import { resolve } from "path";
import type { DetectedSystem } from "../types.js";
import { detectOpenClawVersion } from "../utils/config.js";

function detectClaudeCodeVersion(): string | null {
  try {
    const out = execSync("claude --version 2>/dev/null", {
      timeout: 3000,
      encoding: "utf-8",
    }).toString().trim();
    const m = out.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Hermes Agent carries two version schemes side by side — semver (0.21.2) and
 * a date tag (v2026.9.11) — and `hermes --version` may print either or both.
 * Prefer the semver form when both appear (a "major" of 2000+ is a date tag).
 */
export function parseHermesVersion(out: string): string | null {
  const all = [...out.matchAll(/v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/g)].map((m) => m[1]);
  if (all.length === 0) return null;
  const semver = all.find((v) => Number(v.split(".")[0]) < 2000);
  return semver ?? all[0];
}

function detectHermesVersion(): string | null {
  try {
    const out = execSync("hermes --version 2>/dev/null", {
      timeout: 3000,
      encoding: "utf-8",
    }).toString().trim();
    return parseHermesVersion(out);
  } catch {
    return null;
  }
}

/** Hermes home: $HERMES_HOME when set (profiles use <root>/profiles/<name>), else ~/.hermes. */
export function resolveHermesHome(): string {
  const env = process.env.HERMES_HOME?.trim();
  return env ? env : resolve(homedir(), ".hermes");
}

export function detectSystems(cwd: string = process.cwd()): DetectedSystem[] {
  const systems: DetectedSystem[] = [];

  // Claude Code — user scope
  const ccUser = resolve(homedir(), ".claude", "settings.json");
  if (existsSync(ccUser)) {
    systems.push({
      kind: "claude-code",
      version: detectClaudeCodeVersion(),
      configPath: ccUser,
      scope: "user",
    });
  }

  // Claude Code — project scope (settings.json preferred over CLAUDE.md)
  const ccProjSettings = resolve(cwd, ".claude", "settings.json");
  const ccProjMd = resolve(cwd, "CLAUDE.md");
  if (existsSync(ccProjSettings) || existsSync(ccProjMd)) {
    systems.push({
      kind: "claude-code",
      version: null, // project scope inherits user version
      configPath: existsSync(ccProjSettings) ? ccProjSettings : ccProjMd,
      scope: "project",
    });
  }

  // OpenClaw
  const ocUser = resolve(homedir(), ".openclaw", "openclaw.json");
  if (existsSync(ocUser)) {
    systems.push({
      kind: "openclaw",
      version: detectOpenClawVersion(),
      configPath: ocUser,
      scope: "user",
    });
  }

  // Hermes Agent — user scope (read-only support: audit, no optimize/fix).
  // Honours HERMES_HOME; named profiles under <home>/profiles/ are discovered
  // by the Hermes runner, not listed as separate systems.
  const hermesUser = resolve(resolveHermesHome(), "config.yaml");
  if (existsSync(hermesUser)) {
    systems.push({
      kind: "hermes",
      version: detectHermesVersion(),
      configPath: hermesUser,
      scope: "user",
    });
  }

  // Cursor — project rules
  const cursorProj = resolve(cwd, ".cursor", "rules");
  if (existsSync(cursorProj)) {
    systems.push({
      kind: "cursor",
      version: null,
      configPath: cursorProj,
      scope: "project",
    });
  }

  return systems;
}
