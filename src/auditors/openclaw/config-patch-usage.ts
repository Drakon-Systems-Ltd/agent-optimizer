import type { AuditResult, OpenClawConfig } from "../../types.js";

const CONFIG_MUTATION_PATTERNS = ["config.patch", "config.apply"];

function findMutationReference(value: unknown): string | null {
  if (typeof value === "string") {
    for (const pattern of CONFIG_MUTATION_PATTERNS) {
      if (value.includes(pattern)) return pattern;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const hit = findMutationReference(v);
      if (hit) return hit;
    }
  }
  return null;
}

const ALLOWLIST_FIX =
  "OpenClaw v2026.4.23+ only accepts agent-driven config.patch/apply on allowlisted paths (prompt, model, mention-gating). Remove the reference or migrate the mutation to a build-time config change.";

export function auditConfigPatchUsage(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];

  // Legacy handlers[] (hooks.internal.handlers)
  const handlers = config.hooks?.internal?.handlers ?? [];
  for (const handler of handlers) {
    const module = handler?.module;
    const hit = findMutationReference(module);
    if (hit) {
      results.push({
        category: "Config Patch Usage",
        check: `Legacy handler references ${hit}`,
        status: "warn",
        message: `Hook handler module "${module}" references ${hit} — will fail closed on non-allowlisted paths in v2026.4.23+.`,
        fix: ALLOWLIST_FIX,
      });
    }
  }

  // Keyed entries (hooks.internal.entries)
  const entries = config.hooks?.internal?.entries ?? {};
  for (const [name, entry] of Object.entries(entries)) {
    const hit = findMutationReference(entry);
    if (hit) {
      results.push({
        category: "Config Patch Usage",
        check: `Hook entry "${name}" references ${hit}`,
        status: "warn",
        message: `Hook "${name}" contains a reference to ${hit} — will silently fail on non-allowlisted paths in v2026.4.23+.`,
        fix: ALLOWLIST_FIX,
      });
    }
  }

  // Agent tool allowlists
  const agents = config.agents?.list ?? [];
  for (const agent of agents) {
    const allowList = agent.tools?.alsoAllow ?? [];
    const hits = new Set<string>();
    for (const tool of allowList) {
      for (const pattern of CONFIG_MUTATION_PATTERNS) {
        if (tool.includes(pattern)) hits.add(pattern);
      }
    }
    if (hits.size > 0) {
      const hitList = Array.from(hits).join(", ");
      results.push({
        category: "Config Patch Usage",
        check: `Agent "${agent.id}" tool allowlist exposes ${hitList}`,
        status: "warn",
        message: `Agent "${agent.id}" explicitly allows ${hitList} in tools.alsoAllow — these calls will silently fail on non-allowlisted config paths in v2026.4.23+.`,
        fix: ALLOWLIST_FIX,
      });
    }
  }

  return results;
}
