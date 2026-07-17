import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { loadConfig, expandPath } from "../utils/config.js";
import { getOptimizations, type RiskLevel } from "./openclaw/index.js";

export interface PlanProposal {
  id: string;               // "p<N>-<tag>" — stable within a plan
  tag: string;
  path: string;             // config path the mutation touches
  current: unknown;
  recommended: unknown;
  reason: string;
  risk: RiskLevel;
  requiresRestart: boolean;
  info?: boolean;           // info-only proposals are never applied
}

export interface OptimizePlan {
  schemaVersion: 1;
  planId: string;           // 12-hex content hash of configHash + proposals
  createdAt: string;        // ISO
  configPath: string;
  configHash: string;       // sha256 of raw config bytes
  profile: string;
  proposals: PlanProposal[];
}

/**
 * Hash the RAW BYTES of the top-level config file (deliberate: any byte
 * change — even whitespace — invalidates a saved plan against it).
 */
export function configHashOf(configPath: string): string {
  return createHash("sha256").update(readFileSync(expandPath(configPath))).digest("hex");
}

export function defaultPlansDir(): string {
  return join(homedir(), ".agent-optimizer", "plans");
}

export function buildPlan(configPath: string, profile: string): OptimizePlan {
  const config = loadConfig(configPath);
  if (!config) throw new Error(`Config not found or unparseable: ${configPath}`);
  const configHash = configHashOf(configPath);
  const proposals: PlanProposal[] = getOptimizations(config, profile).map((o, i) => ({
    id: `p${i + 1}-${o.tag}`,
    tag: o.tag,
    path: o.path,
    current: o.current,
    recommended: o.recommended,
    reason: o.reason,
    risk: o.risk,
    requiresRestart: o.requiresRestart,
    ...(o.info ? { info: true } : {}),
  }));
  const planId = createHash("sha256")
    .update(configHash)
    .update(profile)
    .update(JSON.stringify(proposals))
    .digest("hex")
    .slice(0, 12);
  return {
    schemaVersion: 1,
    planId,
    createdAt: new Date().toISOString(),
    configPath,
    configHash,
    profile,
    proposals,
  };
}

export function savePlan(plan: OptimizePlan, plansDir = defaultPlansDir()): string {
  mkdirSync(plansDir, { recursive: true });
  const file = join(plansDir, `${plan.planId}.json`);
  writeFileSync(file, JSON.stringify(plan, null, 2));
  return file;
}

export function loadPlan(planId: string, plansDir = defaultPlansDir()): OptimizePlan | null {
  if (!/^[a-f0-9]{12}$/.test(planId)) return null; // also blocks traversal
  const file = resolve(plansDir, `${planId}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf-8")) as OptimizePlan;
}
