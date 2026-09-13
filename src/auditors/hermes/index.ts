import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { parse as parseYaml } from "yaml";
import type { AuditResult } from "../../types.js";
import { expandPath } from "../../utils/config.js";
import type { HermesConfig } from "./types.js";
import { auditHermesModelConfig } from "./model-config.js";
import { auditHermesConfigShape } from "./config-shape.js";
import { auditHermesApprovals } from "./approvals.js";
import { auditHermesPromptCaching, auditHermesCompression } from "./token-efficiency.js";
import { auditHermesMemory } from "./memory.js";
import { auditHermesChannelSecurity } from "./channel-security.js";
import { auditHermesPrivacy } from "./privacy.js";
import { auditHermesSkillsSafety } from "./skills-safety.js";
import { auditHermesAuthHygiene } from "./auth-hygiene.js";
import { auditHermesConfigVersion } from "./config-version.js";
import { auditHermesRemovedKeys } from "./removed-keys.js";

// Hermes Agent support is READ-ONLY: audit findings only, no optimize/fix
// paths, nothing autoFixable — so every finding stamps machineFixable: false.

interface AuditorModule {
  name: string;
  run: () => AuditResult[];
}

export interface HermesProfile {
  name: string;
  dir: string;
}

// Named profiles live at <hermes-home>/profiles/<name>/ and are full Hermes
// homes of their own (config.yaml, auth.json, ...). Hermes skips names that
// start with "." and refuses tombstoned profiles (profiles/.deleted/<name>,
// written by `hermes profile delete`) — mirror both so we never audit a
// profile Hermes itself would refuse to load.
const PROFILES_DIR = "profiles";
const DELETED_PROFILES_DIR = ".deleted";

/** List live named profiles under a Hermes home. Read-only; missing dir = []. */
export function discoverHermesProfiles(hermesDir: string): HermesProfile[] {
  const profilesDir = join(expandPath(hermesDir), PROFILES_DIR);
  if (!existsSync(profilesDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(profilesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
  } catch {
    return [];
  }
  return entries
    .filter((name) => !existsSync(join(profilesDir, DELETED_PROFILES_DIR, name)))
    .filter((name) => existsSync(join(profilesDir, name, "config.yaml")))
    .sort()
    .map((name) => ({ name, dir: join(profilesDir, name) }));
}

/**
 * Run all Hermes auditors against one Hermes home (root or a named profile).
 * Reads config.yaml + auth.json; never writes.
 */
function auditHermesHome(dir: string): AuditResult[] {
  const configPath = resolve(dir, "config.yaml");
  const results: AuditResult[] = [];

  let config: HermesConfig | null = null;
  if (!existsSync(configPath)) {
    results.push({
      category: "Hermes Config",
      check: "config.yaml exists",
      status: "warn",
      message: `Hermes config not found: ${configPath}`,
      system: "hermes" as const,
    });
  } else {
    try {
      const parsed: unknown = parseYaml(readFileSync(configPath, "utf-8"));
      if (parsed === null || parsed === undefined) {
        config = {}; // empty file — audit against an empty mapping
      } else if (typeof parsed === "object" && !Array.isArray(parsed)) {
        config = parsed as HermesConfig;
      } else {
        results.push({
          category: "Hermes Config",
          check: "config.yaml parseable",
          status: "warn",
          message: "config.yaml is valid YAML but not a mapping — cannot audit",
          system: "hermes" as const,
        });
      }
    } catch (err) {
      results.push({
        category: "Hermes Config",
        check: "config.yaml parseable",
        status: "warn",
        message: `Could not parse config.yaml: ${(err as Error).message}`,
        system: "hermes" as const,
      });
    }
  }

  const auditors: AuditorModule[] = config
    ? [
        { name: "Hermes Config Version", run: () => auditHermesConfigVersion(config!) },
        { name: "Hermes Model Config", run: () => auditHermesModelConfig(config!) },
        { name: "Hermes Config Shape", run: () => auditHermesConfigShape(config!) },
        { name: "Hermes Removed Keys", run: () => auditHermesRemovedKeys(config!) },
        { name: "Hermes Approvals", run: () => auditHermesApprovals(config!) },
        { name: "Hermes Caching", run: () => auditHermesPromptCaching(config!) },
        { name: "Hermes Compression", run: () => auditHermesCompression(config!) },
        { name: "Hermes Memory", run: () => auditHermesMemory(config!) },
        { name: "Hermes Channel Security", run: () => auditHermesChannelSecurity(config!) },
        { name: "Hermes Privacy", run: () => auditHermesPrivacy(config!) },
        { name: "Hermes Skills", run: () => auditHermesSkillsSafety(config!) },
      ]
    : [];
  auditors.push({
    name: "Hermes Auth",
    run: () => auditHermesAuthHygiene(resolve(dir, "auth.json")),
  });

  // Isolate each auditor (same pattern as the OpenClaw runner): a throw on a
  // malformed config must not abort the run — auditing broken configs is the point.
  for (const auditor of auditors) {
    try {
      results.push(...auditor.run().map((r) => ({ ...r, system: "hermes" as const })));
    } catch (err) {
      results.push({
        category: auditor.name,
        check: `${auditor.name} auditor`,
        status: "warn",
        message: `Auditor "${auditor.name}" errored on this config and was skipped: ${(err as Error).message}`,
        system: "hermes" as const,
      });
    }
  }

  return results;
}

/**
 * Run the Hermes auditor family against a Hermes home directory (normally
 * ~/.hermes or $HERMES_HOME; tests pass a temp dir) and against every live
 * named profile under <home>/profiles/<name>/. Profile findings are labelled
 * with the profile name in `check` so ids stay distinct from the root's.
 */
export function runHermesAuditors(
  hermesDir: string,
  opts: { includeProfiles?: boolean } = {}
): AuditResult[] {
  const dir = expandPath(hermesDir);
  const results = auditHermesHome(dir);

  if (opts.includeProfiles === false) return results;

  const profiles = discoverHermesProfiles(dir);
  if (profiles.length > 0) {
    results.push({
      category: "Hermes Profiles",
      check: "Named profiles",
      status: "info",
      message: `${profiles.length} named Hermes profile(s) under profiles/: ${profiles.map((p) => p.name).join(", ")} — each audited below`,
      system: "hermes" as const,
    });
    for (const profile of profiles) {
      results.push(
        ...auditHermesHome(profile.dir).map((r) => ({
          ...r,
          check: `[profile ${profile.name}] ${r.check}`,
        }))
      );
    }
  }

  return results;
}
