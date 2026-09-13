import type { AuditResult } from "../../types.js";
import type { HermesConfig } from "./types.js";

// Hermes config schema versioning (hermes_cli/config_migrations.py +
// hermes_cli/config.py in Hermes Agent 0.21.2 / v2026.9.11).
//
// - DEFAULT_CONFIG._config_version is the latest schema; `hermes config
//   migrate` (also run at startup) walks a config forward one step at a time.
// - SUPPORT_FLOOR_VERSION: a config whose EXPLICIT on-disk _config_version is
//   below this is refused by the migration ladder and left byte-for-byte
//   untouched — defaults are deep-merged at read time, but no migration step
//   ever runs, so retired keys and renamed fields silently persist.
// - A config with NO _config_version is treated upstream as a fresh minimal
//   config (normal ladder + version stamp), not an ancient install — so we
//   stay quiet on absence.
export const HERMES_SUPPORT_FLOOR_VERSION = 12;
export const HERMES_LATEST_CONFIG_VERSION = 44;

/** Mirror of upstream _coerce_config_version: bool/non-int/negative -> 0 (legacy). */
export function coerceHermesConfigVersion(value: unknown): number {
  if (typeof value === "boolean") return 0;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.max(Math.trunc(n), 0);
}

export function auditHermesConfigVersion(config: HermesConfig): AuditResult[] {
  const results: AuditResult[] = [];
  if (!config || !("_config_version" in config)) return results; // fresh config — upstream stamps it

  const raw = config["_config_version"];
  const version = coerceHermesConfigVersion(raw);
  const invalid = typeof raw !== "number" || !Number.isInteger(raw) || raw < 0;

  if (version < HERMES_SUPPORT_FLOOR_VERSION) {
    results.push({
      category: "Hermes Config Version",
      check: "Config schema version",
      status: "warn",
      message: invalid
        ? `_config_version is ${JSON.stringify(raw)} — Hermes treats an invalid value as legacy (0), which is below the auto-migration support floor (v${HERMES_SUPPORT_FLOOR_VERSION}): no migration step will run and retired keys persist silently`
        : `_config_version: ${version} is below Hermes' auto-migration support floor (v${HERMES_SUPPORT_FLOOR_VERSION}) — Hermes will NOT auto-migrate this config; migration steps up to v${HERMES_LATEST_CONFIG_VERSION} are skipped and retired keys persist silently`,
      fix: `Back up config.yaml, then either run \`hermes setup\` to regenerate it, or review the changelog and set _config_version: ${HERMES_SUPPORT_FLOOR_VERSION} by hand so \`hermes config migrate\` can bring it forward. \`hermes doctor\` reports the same condition.`,
    });
  } else if (version < HERMES_LATEST_CONFIG_VERSION) {
    results.push({
      category: "Hermes Config Version",
      check: "Config schema version",
      status: "info",
      message: `_config_version: ${version} is behind the Hermes 0.21.2 schema (v${HERMES_LATEST_CONFIG_VERSION}) — Hermes auto-migrates it on next start; run \`hermes config migrate\` to do it now`,
    });
  } else {
    results.push({
      category: "Hermes Config Version",
      check: "Config schema version",
      status: "pass",
      message: `_config_version: ${version} (current schema is v${HERMES_LATEST_CONFIG_VERSION})`,
    });
  }

  return results;
}
