import type { AuditResult } from "../types.js";

/**
 * Deterministic kebab-case slug of `${category}/${check}`. Lowercased; every run
 * of non-alphanumeric characters (spaces, slashes, punctuation) collapses to a
 * single hyphen; leading/trailing hyphens are trimmed.
 *
 * Stable by design: agents hardcode these ids to key decisions off, so the map
 * from (category, check) to slug must not drift run-to-run. The message is NOT
 * part of the slug — it varies per run (interpolated values, counts).
 *
 * e.g. ("Model Config", "thinkingDefault value") -> "model-config-thinkingdefault-value"
 */
export function slugifyFinding(category: string, check: string): string {
  return `${category}/${check}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A finding is machine-fixable when it is flagged `autoFixable` AND carries a
 * concrete `apply` payload that `audit --fix` can execute.
 *
 * This is the SINGLE source of truth for that predicate: `findingsWithFixes`
 * (the exact set `audit --fix` acts on) and the `machineFixable` flag stamped
 * onto the report both call it, so the JSON flag can never disagree with what a
 * fix run would actually touch.
 */
export function isMachineFixable(r: AuditResult): boolean {
  return r.autoFixable === true && Array.isArray(r.apply) && r.apply.length > 0;
}

/**
 * Return a new array where every result carries a stable `id` and an explicit
 * `machineFixable` flag. Inputs are not mutated.
 *
 * The id is the category/check slug. When two findings slugify to the same base,
 * the first keeps the bare slug and each subsequent collision is suffixed `-2`,
 * `-3`, … so ids are unique within a single report. Deterministic given input
 * order.
 */
export function stampFindingIds(results: AuditResult[]): AuditResult[] {
  const seen = new Map<string, number>();
  return results.map((r) => {
    const base = slugifyFinding(r.category, r.check);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const id = count === 1 ? base : `${base}-${count}`;
    return { ...r, id, machineFixable: isMachineFixable(r) };
  });
}
