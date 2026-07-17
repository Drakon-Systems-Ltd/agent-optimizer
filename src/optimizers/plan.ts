import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import {
  loadConfigFromString,
  expandPath,
  getConfigIncludePaths,
} from "../utils/config.js";
import { getOptimizations, PROFILE_NAMES, type RiskLevel } from "./openclaw/index.js";

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
  planId: string;           // 12-hex content hash of configHash + profile + proposals
  createdAt: string;        // ISO
  configPath: string;
  configHash: string;       // content hash of the config file + all $include'd fragments
  profile: string;
  proposals: PlanProposal[];
}

function sha256(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

/**
 * Chain of per-file sha256 digests: the top-level file first, then every
 * $include'd fragment in sorted-path order. Proposals are computed from the
 * RESOLVED config, so the hash must cover every file that contributed bytes
 * to it — any byte change in any of them (even whitespace) marks saved plans
 * stale. Fixed-width per-file digests avoid concatenation ambiguity.
 */
function hashConfigContent(topLevelBytes: Buffer, includePaths: string[]): string {
  const h = createHash("sha256").update(sha256(topLevelBytes));
  for (const p of [...new Set(includePaths)].sort()) {
    h.update(sha256(readFileSync(p)));
  }
  return h.digest("hex");
}

/**
 * Hash a config file plus its $include'd fragments. When includePaths is
 * omitted the config is parsed (from the same bytes being hashed) to discover
 * them; buildPlan passes the paths from its own load to avoid a second parse.
 */
export function configHashOf(configPath: string, includePaths?: string[]): string {
  const raw = readFileSync(expandPath(configPath));
  let paths = includePaths;
  if (paths === undefined) {
    loadConfigFromString(raw.toString("utf-8"), configPath);
    paths = getConfigIncludePaths();
  }
  return hashConfigContent(raw, paths);
}

export function defaultPlansDir(): string {
  return join(homedir(), ".agent-optimizer", "plans");
}

export function buildPlan(configPath: string, profile: string): OptimizePlan {
  if (!PROFILE_NAMES.includes(profile)) {
    throw new Error(
      `Unknown profile "${profile}" — expected one of: ${PROFILE_NAMES.join(", ")}`
    );
  }
  const resolved = expandPath(configPath);
  if (!existsSync(resolved)) throw new Error(`Config not found: ${configPath}`);
  // Read once; parse and hash the same bytes so the plan's hash always
  // matches the config the proposals were computed from.
  const rawBytes = readFileSync(resolved);
  const config = loadConfigFromString(rawBytes.toString("utf-8"), configPath);
  if (!config) throw new Error(`Config unparseable (not a JSON object): ${configPath}`);
  const configHash = hashConfigContent(rawBytes, getConfigIncludePaths());
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
  // Atomic: write to a temp file in the same dir, then rename over the target
  // so a crash mid-write can never leave a truncated plan behind.
  const tmp = join(plansDir, `.${plan.planId}.json.tmp`);
  writeFileSync(tmp, JSON.stringify(plan, null, 2));
  renameSync(tmp, file);
  return file;
}

export function loadPlan(planId: string, plansDir = defaultPlansDir()): OptimizePlan | null {
  if (!/^[a-f0-9]{12}$/.test(planId)) return null; // also blocks traversal
  const file = resolve(plansDir, `${planId}.json`);
  if (!existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8"));
  } catch (err) {
    throw new Error(`Corrupt plan file: ${file} (${(err as Error).message})`);
  }
  // Unknown schema versions are unusable, not corrupt — treat like no plan.
  if (typeof parsed !== "object" || parsed === null) return null;
  if ((parsed as { schemaVersion?: unknown }).schemaVersion !== 1) return null;
  return parsed as OptimizePlan;
}
