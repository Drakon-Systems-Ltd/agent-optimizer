import type { AuditResult, OpenClawConfig } from "../../types.js";

// Known OpenClaw hook events as of v2026.3.14. Includes deprecated
// before_agent_start (flagged separately by hooks-deprecations.ts).
const KNOWN_EVENTS = new Set([
  "command:new", "command:reset", "command:stop",
  "session:compact:before", "session:compact:after",
  "agent:bootstrap", "gateway:startup",
  "message:received", "message:transcribed", "message:preprocessed", "message:sent",
  // Plugin-invocable hooks
  "tool_result_persist", "before_compaction", "after_compaction",
  "before_model_resolve", "before_prompt_build",
  // Deprecated but still handled
  "before_agent_start",
]);

export function auditHookEvents(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];
  const entries = config.hooks?.internal?.entries ?? {};
  for (const [name, entry] of Object.entries(entries)) {
    const event = entry?.event;
    if (event && !KNOWN_EVENTS.has(event)) {
      results.push({
        category: "Hooks",
        check: `Unknown event: ${name}`,
        status: "fail",
        message: `Unknown hook event "${event}" in entry "${name}" — hook will never fire`,
        fix: "Check OpenClaw docs/automation/hooks.md for the current event list, or fix the typo",
      });
    }
  }
  return results;
}
