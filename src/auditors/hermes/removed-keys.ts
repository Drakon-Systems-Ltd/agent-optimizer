import type { AuditResult } from "../../types.js";
import { section, type HermesConfig } from "./types.js";

// Keys removed by Hermes config migrations 38+ (hermes_cli/config_migrations.py
// in Hermes Agent 0.21.2). `hermes config migrate` deletes them on an
// in-support config; they linger on configs below the support floor or edited
// by hand after migration, where Hermes silently ignores them. Reasons quote
// the upstream migration comments so the audit and the migrator agree.

// hermes_cli/relay_plugin_cutover.py LEGACY_RELAY_PLUGIN_KEYS (migration 37 -> 38).
export const HERMES_LEGACY_RELAY_PLUGIN_KEYS = new Set(["nemo_relay", "observability/nemo_relay"]);

const migrateFix = "Run: hermes config migrate (removes it), or delete the key with `hermes config edit`";

export function auditHermesRemovedKeys(config: HermesConfig): AuditResult[] {
  const results: AuditResult[] = [];

  // 37 -> 38: the bundled observability/nemo_relay plugin was removed (Relay
  // lifecycle moved into the agent core); drop it from plugins.enabled.
  const plugins = section(config, "plugins");
  const enabled = plugins?.["enabled"];
  if (Array.isArray(enabled)) {
    const legacy = enabled.filter(
      (v): v is string => typeof v === "string" && HERMES_LEGACY_RELAY_PLUGIN_KEYS.has(v)
    );
    if (legacy.length > 0) {
      results.push({
        category: "Hermes Removed Keys",
        check: "Legacy Relay plugin in plugins.enabled",
        status: "warn",
        message: `plugins.enabled lists the removed Relay plugin (${[...new Set(legacy)].sort().join(", ")}) — the bundled observability/nemo_relay plugin was removed in Hermes config v38 (Relay lifecycle moved into the agent core); the entry is ignored`,
        fix: "Run: hermes config migrate (drops it). Configure native Relay plugins with HERMES_NEMO_RELAY_PLUGINS_TOML instead",
      });
    }
  }

  // 41 -> 42: cron.model_drift_guard is gone. Unpinned jobs now run on their
  // creation snapshot instead of failing closed when the global model changes,
  // so the toggle has nothing to gate.
  const cron = section(config, "cron");
  if (cron && cron["model_drift_guard"] !== undefined && cron["model_drift_guard"] !== null) {
    results.push({
      category: "Hermes Removed Keys",
      check: "cron.model_drift_guard",
      status: "warn",
      message: "cron.model_drift_guard was removed in Hermes config v42 — unpinned cron jobs now keep running on the model/provider they were created under when the global default changes, so the toggle has nothing to gate and is ignored",
      fix: `${migrateFix}. Pin a job or set cron.model to move it`,
    });
  }

  // 42 -> 43: gateway.multiplex_profile_allowlist is gone. A multiplexing
  // default gateway serves every live profile under profiles/; a profile that
  // must not be served is archived or deleted.
  const gateway = section(config, "gateway");
  if (gateway && "multiplex_profile_allowlist" in gateway) {
    results.push({
      category: "Hermes Removed Keys",
      check: "gateway.multiplex_profile_allowlist",
      status: "warn",
      message: "gateway.multiplex_profile_allowlist was removed in Hermes config v43 — the multiplexing gateway now serves every profile under profiles/, so the allowlist is ignored; delete or archive a profile you do not want served",
      fix: migrateFix,
    });
  }

  return results;
}
