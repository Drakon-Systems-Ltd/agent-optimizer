import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  auditHermesConfigVersion,
  coerceHermesConfigVersion,
  HERMES_SUPPORT_FLOOR_VERSION,
  HERMES_LATEST_CONFIG_VERSION,
} from "../src/auditors/hermes/config-version.js";
import {
  auditHermesRemovedKeys,
  HERMES_LEGACY_RELAY_PLUGIN_KEYS,
} from "../src/auditors/hermes/removed-keys.js";
import { parseHermesVersion } from "../src/detect/index.js";
import type { HermesConfig } from "../src/auditors/hermes/types.js";

// Hermes Agent 0.21.2 (v2026.9.11) drift: config schema floor + removed keys
// from config_migrations.py, and the dual version scheme.
function fromYaml(y: string): HermesConfig {
  return (parseYaml(y) ?? {}) as HermesConfig;
}

describe("auditHermesConfigVersion", () => {
  it("pins the upstream constants (config_migrations.py / config_defaults.py)", () => {
    expect(HERMES_SUPPORT_FLOOR_VERSION).toBe(12);
    expect(HERMES_LATEST_CONFIG_VERSION).toBe(44);
  });

  it("stays quiet when _config_version is absent (fresh config gets the normal ladder)", () => {
    expect(auditHermesConfigVersion(fromYaml(`model:\n  default: x\n`))).toHaveLength(0);
  });

  it("warns below the support floor and says Hermes will not auto-migrate", () => {
    const results = auditHermesConfigVersion(fromYaml(`_config_version: 11\n`));
    const r = results.find((x) => x.check === "Config schema version");
    expect(r?.status).toBe("warn");
    expect(r?.message).toContain("will NOT auto-migrate");
    expect(r?.message).toContain("v12");
    expect(r?.fix).toContain("hermes config migrate");
    expect(r?.fix).toContain("hermes doctor");
    expect(r?.fix).toContain("hermes setup");
  });

  it("warns on an invalid _config_version (treated as legacy 0)", () => {
    for (const yaml of [`_config_version: true\n`, `_config_version: "abc"\n`, `_config_version: -3\n`]) {
      const r = auditHermesConfigVersion(fromYaml(yaml)).find((x) => x.check === "Config schema version");
      expect(r?.status, yaml).toBe("warn");
      expect(r?.message, yaml).toContain("legacy (0)");
    }
  });

  it("emits info for an in-support but stale schema", () => {
    const r = auditHermesConfigVersion(fromYaml(`_config_version: 12\n`)).find((x) => x.check === "Config schema version");
    expect(r?.status).toBe("info");
    expect(r?.message).toContain("v44");
    expect(r?.message).toContain("hermes config migrate");
  });

  it("passes on the current schema (and newer)", () => {
    expect(auditHermesConfigVersion(fromYaml(`_config_version: 44\n`))[0].status).toBe("pass");
    expect(auditHermesConfigVersion(fromYaml(`_config_version: 45\n`))[0].status).toBe("pass");
  });

  it("coerces like upstream _coerce_config_version", () => {
    expect(coerceHermesConfigVersion(true)).toBe(0);
    expect(coerceHermesConfigVersion("12")).toBe(12);
    expect(coerceHermesConfigVersion(-1)).toBe(0);
    expect(coerceHermesConfigVersion("x")).toBe(0);
    expect(coerceHermesConfigVersion(44.9)).toBe(44);
  });
});

describe("auditHermesRemovedKeys", () => {
  it("pins the legacy relay plugin identities from relay_plugin_cutover.py", () => {
    expect([...HERMES_LEGACY_RELAY_PLUGIN_KEYS].sort()).toEqual(["nemo_relay", "observability/nemo_relay"]);
  });

  it("emits nothing on a config without removed keys", () => {
    const config = fromYaml(`cron:\n  model: x\ngateway:\n  port: 1\nplugins:\n  enabled:\n    - langfuse\n`);
    expect(auditHermesRemovedKeys(config)).toHaveLength(0);
  });

  it.each(["nemo_relay", "observability/nemo_relay"])(
    "warns when plugins.enabled lists the removed relay plugin %s",
    (key) => {
      const config = fromYaml(`plugins:\n  enabled:\n    - langfuse\n    - ${key}\n`);
      const r = auditHermesRemovedKeys(config).find((x) => x.check === "Legacy Relay plugin in plugins.enabled");
      expect(r?.status).toBe("warn");
      expect(r?.message).toContain(key);
      expect(r?.message).toContain("Relay lifecycle moved into the agent core");
      expect(r?.fix).toContain("HERMES_NEMO_RELAY_PLUGINS_TOML");
    }
  );

  it("does not warn on the string-not-list plugins.enabled defect (shape auditor territory)", () => {
    const config = fromYaml(`plugins:\n  enabled: "['nemo_relay']"\n`);
    expect(auditHermesRemovedKeys(config)).toHaveLength(0);
  });

  it("warns on cron.model_drift_guard with the migration-42 reason", () => {
    for (const yaml of [`cron:\n  model_drift_guard: true\n`, `cron:\n  model_drift_guard: false\n`]) {
      const r = auditHermesRemovedKeys(fromYaml(yaml)).find((x) => x.check === "cron.model_drift_guard");
      expect(r?.status, yaml).toBe("warn");
      expect(r?.message, yaml).toContain("created under");
      expect(r?.fix, yaml).toContain("hermes config migrate");
    }
  });

  it("warns on gateway.multiplex_profile_allowlist with the migration-43 reason", () => {
    const r = auditHermesRemovedKeys(fromYaml(`gateway:\n  multiplex_profile_allowlist:\n    - work\n`)).find(
      (x) => x.check === "gateway.multiplex_profile_allowlist"
    );
    expect(r?.status).toBe("warn");
    expect(r?.message).toContain("every profile under profiles/");
  });

  it("flags all three at once", () => {
    const config = fromYaml(
      [
        "cron:",
        "  model_drift_guard: true",
        "gateway:",
        "  multiplex_profile_allowlist: []",
        "plugins:",
        "  enabled:",
        "    - observability/nemo_relay",
        "",
      ].join("\n")
    );
    const checks = auditHermesRemovedKeys(config).map((r) => r.check).sort();
    expect(checks).toEqual([
      "Legacy Relay plugin in plugins.enabled",
      "cron.model_drift_guard",
      "gateway.multiplex_profile_allowlist",
    ]);
  });
});

describe("parseHermesVersion — dual version scheme", () => {
  it("parses the semver form", () => {
    expect(parseHermesVersion("hermes 0.21.2")).toBe("0.21.2");
    expect(parseHermesVersion("Hermes Agent 0.21.2")).toBe("0.21.2");
  });

  it("parses the date-tag form", () => {
    expect(parseHermesVersion("hermes v2026.9.11")).toBe("2026.9.11");
    expect(parseHermesVersion("v2026.9.11")).toBe("2026.9.11");
  });

  it("prefers the semver form when both appear, in either order", () => {
    expect(parseHermesVersion("Hermes Agent 0.21.2 (v2026.9.11)")).toBe("0.21.2");
    expect(parseHermesVersion("hermes v2026.9.11 / 0.21.2")).toBe("0.21.2");
  });

  it("keeps pre-release suffixes and returns null when nothing matches", () => {
    expect(parseHermesVersion("hermes 0.22.0-rc.1")).toBe("0.22.0-rc.1");
    expect(parseHermesVersion("hermes: unknown")).toBeNull();
  });
});
