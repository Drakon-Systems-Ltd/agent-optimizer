import type { AuditResult, OpenClawConfig } from "../types.js";

export function auditHooksDeprecations(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];
  const internal = config.hooks?.internal;
  if (!internal) return results;

  if (Array.isArray(internal.handlers) && internal.handlers.length > 0) {
    results.push({
      category: "Hooks",
      check: "Legacy handlers[] format",
      status: "warn",
      message: "hooks.internal.handlers[] is deprecated — replaced by directory-based discovery with entries.<name>",
      fix: "Migrate handlers to ~/.openclaw/hooks/<name>/ directories and configure via hooks.internal.entries.<name>",
    });
  }

  const entries = internal.entries ?? {};
  for (const [name, entry] of Object.entries(entries)) {
    if (entry?.event === "before_agent_start") {
      results.push({
        category: "Hooks",
        check: `Deprecated event: ${name}`,
        status: "warn",
        message: `Hook "${name}" uses before_agent_start — deprecated in favour of before_model_resolve / before_prompt_build`,
        fix: "Split the hook into before_model_resolve (for model selection) and before_prompt_build (for prompt changes)",
      });
    }
  }

  return results;
}
