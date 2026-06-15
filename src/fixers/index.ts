import { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync } from "fs";
import { resolve } from "path";
import { expandPath } from "../utils/config.js";
import type { AuditReport, AuditResult, FixOperation } from "../types.js";

export interface FileFixResult {
  file: string; // absolute path of the file written (or that would be written in dry-run)
  backup: string; // absolute path of the .pre-fix.bak backup
  opsApplied: number;
}

export interface FixApplyResult {
  applied: number; // total operations that changed something
  findings: number; // number of findings that carried apply payloads
  skipped: number; // autoFixable findings WITHOUT a machine-applicable payload
  files: FileFixResult[]; // one entry per file actually changed
  dryRun: boolean;
}

const BACKUP_SUFFIX = ".pre-fix.bak";

type Json = Record<string, unknown>;

// Resolve the parent container and final key for a dot-path. Numeric segments
// index into arrays. Returns null if any intermediate segment is missing or not
// an object/array — we only edit paths that already exist (these are fixes to
// existing values, never key creation).

// Reject keys that could pollute prototypes or truncate arrays. This engine is
// exported and only as safe as its inputs, so it refuses dangerous segments
// outright rather than trusting every caller.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype", "length"]);

function ownProp(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function resolveParent(
  root: unknown,
  parts: string[]
): { parent: Record<string, unknown>; key: string } | null {
  if (parts.some((p) => UNSAFE_KEYS.has(p) || p === "")) return null;
  let obj: unknown = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (obj === null || typeof obj !== "object") return null;
    obj = (obj as Record<string, unknown>)[parts[i]];
  }
  if (obj === null || typeof obj !== "object") return null;
  return { parent: obj as Record<string, unknown>, key: parts[parts.length - 1] };
}

// Apply a single operation to a parsed JSON tree in place. Returns true if it
// actually changed anything (idempotent / no-op ops return false).
export function applyOp(root: Json, op: FixOperation): boolean {
  const parts = op.path.split(".");
  const loc = resolveParent(root, parts);
  if (!loc) return false;
  const { parent, key } = loc;

  switch (op.op) {
    case "set": {
      if (parent[key] === op.value) return false;
      parent[key] = op.value;
      return true;
    }
    case "delete": {
      if (Array.isArray(parent)) return false; // never delete array indices (leaves holes)
      if (!ownProp(parent, key)) return false;
      delete parent[key];
      return true;
    }
    case "arrayRemove": {
      const arr = parent[key];
      if (!Array.isArray(arr)) return false;
      const remove = op.remove ?? [];
      const filtered = arr.filter((item) => !remove.includes(item));
      if (filtered.length === arr.length) return false;
      parent[key] = filtered;
      return true;
    }
    case "arrayReplace": {
      const arr = parent[key];
      if (!Array.isArray(arr)) return false;
      let changed = false;
      const next = arr.map((item) => {
        if (item === op.match) {
          changed = true;
          return op.value;
        }
        return item;
      });
      if (!changed) return false;
      parent[key] = next;
      return true;
    }
    default:
      return false;
  }
}

// arrayRemove must run before arrayReplace on the same array: if a value is both
// a removal target and a replace target, removing it first is the correct outcome
// (a duplicate is dropped, not canonicalized into a fresh duplicate).
function opOrder(op: FixOperation): number {
  return op.op === "arrayRemove" ? 0 : 1;
}

export function findingsWithFixes(report: AuditReport): AuditResult[] {
  return report.results.filter((r) => r.autoFixable && r.apply && r.apply.length > 0);
}

export function autoFixableWithoutPayload(report: AuditReport): number {
  return report.results.filter((r) => r.autoFixable && (!r.apply || r.apply.length === 0)).length;
}

export interface ApplyFixesOpts {
  configPath: string; // the openclaw.json path passed via -c
  agentDir: string; // agent directory; models.json is resolved within it
  dryRun?: boolean;
}

/**
 * Apply every machine-applicable fix in the report. Operations are grouped by
 * target file; each touched file is backed up to <file>.pre-fix.bak before being
 * written. In dry-run mode nothing is written but the change counts are computed
 * against an in-memory copy.
 */
export function applyFixes(report: AuditReport, opts: ApplyFixesOpts): FixApplyResult {
  const dryRun = !!opts.dryRun;
  const findings = findingsWithFixes(report);
  const skipped = autoFixableWithoutPayload(report);

  const configFile = expandPath(opts.configPath);
  const modelsFile = resolve(expandPath(opts.agentDir), "models.json");
  const targetFile: Record<FixOperation["target"], string> = {
    config: configFile,
    models: modelsFile,
  };

  // Bucket operations by target file, preserving order.
  const opsByTarget: Record<FixOperation["target"], FixOperation[]> = { config: [], models: [] };
  for (const f of findings) {
    for (const op of f.apply!) opsByTarget[op.target].push(op);
  }

  const files: FileFixResult[] = [];
  let applied = 0;

  for (const target of ["config", "models"] as const) {
    const ops = opsByTarget[target];
    if (ops.length === 0) continue;

    const file = targetFile[target];
    if (!existsSync(file)) continue; // e.g. models.json absent — skip its ops

    let json: Json;
    try {
      json = JSON.parse(readFileSync(file, "utf-8"));
    } catch {
      continue; // unreadable / invalid JSON — never write over it
    }

    let changed = 0;
    const ordered = [...ops].sort((a, b) => opOrder(a) - opOrder(b));
    for (const op of ordered) {
      if (applyOp(json, op)) changed++;
    }
    if (changed === 0) continue;

    const backup = `${file}${BACKUP_SUFFIX}`;
    if (!dryRun) {
      // Never clobber an existing backup: the first one holds the pristine
      // pre-fix original, which is the only artifact that can undo repeated runs.
      if (!existsSync(backup)) copyFileSync(file, backup);
      // Write atomically (temp + rename) so a crash mid-write can never leave a
      // truncated config — the original stays intact until rename swaps it in.
      const tmp = `${file}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify(json, null, 2) + "\n");
      renameSync(tmp, file);
    }
    files.push({ file, backup, opsApplied: changed });
    applied += changed;
  }

  return { applied, findings: findings.length, skipped, files, dryRun };
}
