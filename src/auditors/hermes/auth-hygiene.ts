import { existsSync, readFileSync } from "fs";
import type { AuditResult } from "../../types.js";

// Mirrors the OpenClaw auth-profiles token-expiry check, but defensive about
// the (undocumented) ~/.hermes/auth.json schema: providers may be a mapping or
// a list, and expiry may live under several field names as epoch seconds, epoch
// millis, or an ISO string. Entries with no recognisable expiry emit nothing.
const EXPIRY_FIELDS = ["expires_at", "expiresAt", "expiry", "expires"];

/** Parse an expiry-like value into epoch millis, or null when unrecognisable. */
function parseExpiry(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) return value; // epoch millis
    if (value > 1e9) return value * 1000; // epoch seconds
    return null; // too small — likely a duration, not a timestamp
  }
  if (typeof value === "string" && value.trim() !== "") {
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? null : ts;
  }
  return null;
}

export function auditHermesAuthHygiene(authPath: string): AuditResult[] {
  const results: AuditResult[] = [];
  if (!existsSync(authPath)) return results;

  let auth: unknown;
  try {
    auth = JSON.parse(readFileSync(authPath, "utf-8"));
  } catch {
    results.push({
      category: "Hermes Auth",
      check: "auth.json readable",
      status: "warn",
      message: "~/.hermes/auth.json exists but could not be parsed as JSON",
    });
    return results;
  }
  if (!auth || typeof auth !== "object") return results;

  const providers = (auth as Record<string, unknown>)["providers"];

  // Normalise mapping/list into [name, entry] pairs.
  const entries: Array<[string, Record<string, unknown>]> = [];
  if (Array.isArray(providers)) {
    providers.forEach((p, i) => {
      if (p && typeof p === "object" && !Array.isArray(p)) {
        const rec = p as Record<string, unknown>;
        const name =
          (typeof rec.provider === "string" && rec.provider) ||
          (typeof rec.name === "string" && rec.name) ||
          `provider ${i + 1}`;
        entries.push([name, rec]);
      }
    });
  } else if (providers && typeof providers === "object") {
    for (const [name, p] of Object.entries(providers as Record<string, unknown>)) {
      if (p && typeof p === "object" && !Array.isArray(p)) {
        entries.push([name, p as Record<string, unknown>]);
      }
    }
  }

  const now = Date.now();
  for (const [name, entry] of entries) {
    const field = EXPIRY_FIELDS.find((f) => entry[f] !== undefined && entry[f] !== null);
    if (!field) continue; // no recognisable expiry — emit nothing
    const ts = parseExpiry(entry[field]);
    if (ts === null) continue;

    if (ts < now) {
      results.push({
        category: "Hermes Auth",
        check: `Token expiry: ${name}`,
        status: "warn",
        message: `Credential for "${name}" expired ${Math.abs(Math.round((ts - now) / 3600000))}h ago`,
        fix: `Re-authenticate provider "${name}" with Hermes`,
      });
    } else {
      results.push({
        category: "Hermes Auth",
        check: `Token expiry: ${name}`,
        status: "pass",
        message: `Credential for "${name}" valid for ${Math.round((ts - now) / 3600000)}h`,
      });
    }
  }

  return results;
}
