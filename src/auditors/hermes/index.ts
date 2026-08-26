import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
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

// Hermes Agent support is READ-ONLY: audit findings only, no optimize/fix
// paths, nothing autoFixable — so every finding stamps machineFixable: false.

interface AuditorModule {
  name: string;
  run: () => AuditResult[];
}

/**
 * Run all Hermes auditors against a Hermes home directory (normally ~/.hermes;
 * tests pass a temp dir). Reads config.yaml + auth.json; never writes.
 */
export function runHermesAuditors(hermesDir: string): AuditResult[] {
  const dir = expandPath(hermesDir);
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
        { name: "Hermes Model Config", run: () => auditHermesModelConfig(config!) },
        { name: "Hermes Config Shape", run: () => auditHermesConfigShape(config!) },
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
