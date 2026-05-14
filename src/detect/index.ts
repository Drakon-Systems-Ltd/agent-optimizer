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
