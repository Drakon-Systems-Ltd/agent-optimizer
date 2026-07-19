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
 * The id is the category/check slug. The first result with a given slug keeps it
 * bare; any later result whose id would collide is suffixed `-2`, `-3`, … until
 * free. Dedup is on the FINAL assigned id, not the bare slug — otherwise a base
 * slug could equal an earlier result's suffixed id (config-interpolated checks
 * like "b" vs "b 2" both slugify into that space) and produce a duplicate. An
 * empty slug (all-punctuation category+check) falls back to "finding". Ids are
 * therefore unique within a report and deterministic given input order.
 */
export function stampFindingIds(
  results: AuditResult[],
): Array<AuditResult & { id: string; machineFixable: boolean }> {
  const used = new Set<string>();
  return results.map((r) => {
    const base = slugifyFinding(r.category, r.check) || "finding";
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return { ...r, id, machineFixable: isMachineFixable(r) };
  });
}
