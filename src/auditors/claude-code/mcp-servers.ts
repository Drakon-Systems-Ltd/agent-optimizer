import { existsSync, readFileSync } from "fs";
import type { AuditResult } from "../../types.js";

interface McpServer {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

interface ClaudeJson {
  mcpServers?: Record<string, McpServer>;
}

const KNOWN_TYPES = new Set(["stdio", "http", "sse"]);

export function auditMcpServers(claudeJsonPath: string | null): AuditResult[] {
  const results: AuditResult[] = [];
  if (!claudeJsonPath) return results;
  if (!existsSync(claudeJsonPath)) return results;

  let parsed: ClaudeJson;
  try {
    parsed = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
  } catch {
    results.push({
      category: "MCP Servers",
      check: ".claude.json readable",
      status: "warn",
      message: `Could not parse ${claudeJsonPath} as JSON`,
      fix: "Inspect or regenerate ~/.claude.json",
    });
    return results;
  }

  const servers = parsed.mcpServers ?? {};
  const names = Object.keys(servers);
  const count = names.length;

  if (count === 0) {
    results.push({
      category: "MCP Servers",
      check: "MCP server count",
      status: "info",
      message: "No MCP servers configured",
    });
  } else if (count > 25) {
    results.push({
      category: "MCP Servers",
      check: "MCP server count",
      status: "fail",
      message: `${count} MCP servers configured — excessive startup cost`,
      fix: "Remove unused servers from ~/.claude.json",
    });
  } else if (count > 10) {
    results.push({
      category: "MCP Servers",
      check: "MCP server count",
      status: "warn",
      message: `${count} MCP servers configured — likely some unused`,
    });
  }

  for (const name of names) {
    const srv = servers[name] ?? {};
    const type = srv.type;

    if (!type) {
      results.push({
        category: "MCP Servers",
        check: "Missing type field",
        status: "warn",
        message: `MCP server "${name}" has no type field`,
        fix: 'Set "type" to "stdio", "http", or "sse"',
      });
    } else if (!KNOWN_TYPES.has(type)) {
      results.push({
        category: "MCP Servers",
        check: "Unknown server type",
        status: "fail",
        message: `MCP server "${name}" has unknown type "${type}"`,
        fix: 'Use "stdio", "http", or "sse"',
      });
    }

    if (type === "stdio") {
      if (typeof srv.command !== "string" || srv.command.length === 0) {
        results.push({
          category: "MCP Servers",
          check: "stdio server missing command",
          status: "fail",
          message: `MCP server "${name}" is stdio but has no command`,
          fix: "Set a command string",
        });
      }
    }

    if (type === "http" || type === "sse") {
      if (typeof srv.url !== "string" || srv.url.length === 0) {
        results.push({
          category: "MCP Servers",
          check: `${type} server missing url`,
          status: "fail",
          message: `MCP server "${name}" is ${type} but has no url`,
          fix: "Set a url string",
        });
      }
    }

    if (srv.env && typeof srv.env === "object" && Object.keys(srv.env).length === 0) {
      results.push({
        category: "MCP Servers",
        check: "Empty env block",
        status: "info",
        message: `MCP server "${name}" defines an empty env object`,
      });
    }
  }

  return results;
}
