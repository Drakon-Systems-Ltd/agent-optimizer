import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { homedir } from "os";
import type { AuditResult, DetectedSystem } from "../../types.js";
import { auditSettingsPermissions, type ClaudeCodeSettings } from "./settings-permissions.js";
import { auditSettingsHooks } from "./settings-hooks.js";
import { auditMcpServers } from "./mcp-servers.js";
import { auditMemoryFiles } from "./memory-files.js";

export function runClaudeCodeAuditors(systems: DetectedSystem[]): AuditResult[] {
  const ccEntries = systems.filter((s) => s.kind === "claude-code");
  if (ccEntries.length === 0) return [];

  const results: AuditResult[] = [];

  // Run permissions + hooks against each settings.json found
  for (const entry of ccEntries) {
    if (entry.configPath.endsWith("settings.json") && existsSync(entry.configPath)) {
      let settings: ClaudeCodeSettings;
      try {
        settings = JSON.parse(readFileSync(entry.configPath, "utf-8"));
      } catch {
        results.push({
          category: "Permissions",
          check: `${entry.scope} settings.json readable`,
          status: "warn",
          message: `Could not parse ${entry.configPath}`,
          system: "claude-code" as const,
        });
        continue;
      }
      results.push(
        ...auditSettingsPermissions(settings, entry.scope).map((r) => ({
          ...r,
          system: "claude-code" as const,
        })),
      );
      results.push(
        ...auditSettingsHooks(settings).map((r) => ({
          ...r,
          system: "claude-code" as const,
        })),
      );
    }
  }

  // MCP servers — single ~/.claude.json
  const claudeJson = resolve(homedir(), ".claude.json");
  results.push(
    ...auditMcpServers(existsSync(claudeJson) ? claudeJson : null).map((r) => ({
      ...r,
      system: "claude-code" as const,
    })),
  );

  // Memory files
  const memoryPaths: string[] = [];
  const userMd = resolve(homedir(), ".claude", "CLAUDE.md");
  if (existsSync(userMd)) memoryPaths.push(userMd);
  for (const entry of ccEntries.filter((e) => e.scope === "project")) {
    const projMd = entry.configPath.endsWith("CLAUDE.md")
      ? entry.configPath
      : resolve(dirname(entry.configPath), "..", "CLAUDE.md");
    if (existsSync(projMd) && !memoryPaths.includes(projMd)) memoryPaths.push(projMd);
  }
  results.push(
    ...auditMemoryFiles(memoryPaths).map((r) => ({
      ...r,
      system: "claude-code" as const,
    })),
  );

  return results;
}
