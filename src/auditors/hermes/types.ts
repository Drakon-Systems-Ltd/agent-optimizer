// Hermes Agent config (~/.hermes/config.yaml). Loosely typed on purpose — the
// upstream schema moves fast and a known field defect stores list-valued keys
// as quoted strings (see config-shape.ts), so every value is `unknown` until an
// auditor proves its shape. Auditors must be null-tolerant: missing key = info
// or skip, never crash.
export type HermesConfig = Record<string, unknown>;

/** Return config[key] when it is a plain object (YAML mapping), else null. */
export function section(
  config: HermesConfig,
  key: string
): Record<string, unknown> | null {
  const v = config?.[key];
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
