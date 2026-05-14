import type { AuditResult } from "../../types.js";
import type { ClaudeCodeSettings } from "./settings-permissions.js";

const KNOWN_EVENTS = new Set([
  "PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart", "SessionEnd",
  "Stop", "Notification", "PreCompact", "SubagentStop",
]);

export function auditSettingsHooks(settings: ClaudeCodeSettings): AuditResult[] {
  const results: AuditResult[] = [];
  const hooks = settings.hooks;
  if (!hooks) return results;

  for (const event of Object.keys(hooks)) {
    // Unknown event name
    if (!KNOWN_EVENTS.has(event)) {
      results.push({
        category: "Hooks",
        check: "Unknown event name",
        status: "fail",
        message: `Hook configured for unknown event "${event}" — will never fire`,
        fix: `Use one of: ${[...KNOWN_EVENTS].join(", ")}`,
      });
    }

    const entries = hooks[event] ?? [];

    // Hook count per event
    const totalHooks = entries.reduce((sum, e) => sum + (e.hooks?.length ?? 0), 0);
    if (totalHooks > 5) {
      results.push({
        category: "Hooks",
        check: "Hook count per event",
        status: "warn",
        message: `Event "${event}" has ${totalHooks} hook commands attached — runs on every firing`,
        fix: "Consolidate or remove redundant hooks",
      });
    }

    for (const entry of entries) {
      // Invalid matcher regex
      if (typeof entry.matcher === "string" && entry.matcher.length > 0) {
        try {
          new RegExp(entry.matcher);
        } catch {
          results.push({
            category: "Hooks",
            check: "Invalid matcher regex",
            status: "fail",
            message: `Event "${event}" matcher "${entry.matcher}" is not a valid regex`,
            fix: "Correct the matcher pattern or remove it to match all",
          });
        }
      }

      // Empty / missing hooks array
      if (!entry.hooks || entry.hooks.length === 0) {
        results.push({
          category: "Hooks",
          check: "Empty hook entry",
          status: "info",
          message: `Event "${event}" has an entry with no hook commands`,
        });
        continue;
      }

      // Per-hook timeout checks
      for (const h of entry.hooks) {
        if (h.timeout === undefined) {
          results.push({
            category: "Hooks",
            check: "Hook timeout unset",
            status: "info",
            message: `Event "${event}" hook command "${h.command ?? "<unset>"}" has no timeout configured`,
          });
        } else if (typeof h.timeout === "number" && h.timeout > 30) {
          results.push({
            category: "Hooks",
            check: "Hook timeout high",
            status: "warn",
            message: `Event "${event}" hook timeout=${h.timeout}s exceeds 30s — blocks the prompt loop`,
            fix: "Lower the timeout or move work off the hot path",
          });
        }
      }
    }
  }

  return results;
}
