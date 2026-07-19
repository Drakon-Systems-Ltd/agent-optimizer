/**
 * Shared machine-error envelope for the JSON-emitting optimize verbs
 * (`--plan` and `--apply-plan`). One shape — `{ schemaVersion: 1, error: <slug>,
 * message, ...extra }` — so an agent parsing stdout can key off `error` identically
 * across both verbs and can never see two subtly different error shapes. The
 * `schemaVersion` mirrors the audit/scan/rollback/--plan machine payloads.
 */

/** Build the envelope object (no I/O). `schemaVersion`, `error`, and `message`
 *  always lead; any `extra` fields follow. Kept separate from emitPlanError so a
 *  caller that needs the object (e.g. to return it rather than print it) shares the
 *  exact shape. */
export function planErrorEnvelope(
  slug: string,
  message: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { schemaVersion: 1, error: slug, message, ...extra };
}

/**
 * Print the machine-error envelope as pretty JSON on STDOUT and return. The
 * caller owns process.exit — this only writes, so both --plan and --apply-plan
 * decide their own exit code after emitting.
 */
export function emitPlanError(
  slug: string,
  message: string,
  extra?: Record<string, unknown>
): void {
  console.log(JSON.stringify(planErrorEnvelope(slug, message, extra), null, 2));
}
