import type { AuditResult, OpenClawConfig } from "../../types.js";

export function auditToolPermissions(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];
  const list = config.agents?.list ?? [];

  for (let agentIndex = 0; agentIndex < list.length; agentIndex++) {
    const agent = list[agentIndex];
    const tools = agent.tools;
    if (!tools) {
      results.push({
        category: "Tool Permissions",
        check: `Agent "${agent.name}": tools configured`,
        status: "warn",
        message: "No tools block — using defaults (may be restrictive)",
      });
      continue;
    }

    // Check for deny blocks that conflict with alsoAllow
    const allow = tools.alsoAllow ?? [];
    const deny = tools.deny ?? [];

    const conflicts = allow.filter((a) => deny.includes(a));
    if (conflicts.length > 0) {
      results.push({
        category: "Tool Permissions",
        check: `Agent "${agent.name}": tool conflicts`,
        status: "fail",
        message: `Groups in both alsoAllow and deny: ${conflicts.join(", ")}`,
        fix: "Remove conflicting entries from deny",
        autoFixable: true,
        apply: [
          {
            target: "config",
            op: "arrayRemove",
            path: `agents.list.${agentIndex}.tools.deny`,
            remove: conflicts,
          },
        ],
      });
    }

    // Check elevated permissions
    if (allow.includes("group:elevated") && !tools.elevated?.allowFrom) {
      results.push({
        category: "Tool Permissions",
        check: `Agent "${agent.name}": elevated config`,
        status: "warn",
        message: "group:elevated allowed but no allowFrom channels specified",
        fix: "Add elevated.allowFrom to restrict which channels can use elevated tools",
      });
    }

    // Report current permissions
    results.push({
      category: "Tool Permissions",
      check: `Agent "${agent.name}": permissions`,
      status: "info",
      message: `Allow: [${allow.join(", ")}]${deny.length ? ` | Deny: [${deny.join(", ")}]` : ""}`,
    });
  }

  return results;
}
