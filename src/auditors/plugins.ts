import type { AuditResult, OpenClawConfig } from "../types.js";

export function auditPlugins(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];
  const plugins = config.plugins;
  if (!plugins) return results;

  // Check for stale installs
  const installs = plugins.installs ?? {};
  const allow = plugins.allow ?? [];

  for (const [name, install] of Object.entries(installs)) {
    // Check if installed plugin is in allow list
    if (!allow.includes(name)) {
      results.push({
        category: "Plugins",
        check: `Plugin allowlist: ${name}`,
        status: "warn",
        message: `Plugin "${name}" is installed but not in plugins.allow — won't load`,
        fix: `Add "${name}" to plugins.allow or remove the install`,
      });
    }

    // Check install age
    if (install.installedAt) {
      const age = Date.now() - new Date(install.installedAt).getTime();
      const days = Math.round(age / 86400000);
      if (days > 90) {
        results.push({
          category: "Plugins",
          check: `Plugin age: ${name}`,
          status: "info",
          message: `Plugin "${name}" installed ${days} days ago — may need update`,
        });
      }
    }
  }

  // Check for allow entries without installs or entries
  const entries = plugins.entries ?? {};
  for (const name of allow) {
    const hasInstall = name in installs;
    const hasEntry = name in entries;
    if (!hasInstall && !hasEntry) {
      results.push({
        category: "Plugins",
        check: `Plugin exists: ${name}`,
        status: "info",
        message: `"${name}" is in plugins.allow but has no install or entry — may be a bundled plugin`,
      });
    }
  }

  return results;
}
