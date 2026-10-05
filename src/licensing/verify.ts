import { createPublicKey, verify, type KeyObject } from "crypto";

/**
 * Offline license-token verification core.
 *
 * Wire contract (drakonsystems.com `generateAgentOptimizerLicense`): a compact
 * RS256 JWT whose header is `{"alg":"RS256","typ":"JWT","product":"agent-optimizer"}`
 * and whose payload is `{tier, email, features, issued_at, expires_at}`, with
 * `issued_at` an ISO-8601 timestamp and `expires_at` an ISO-8601 timestamp or
 * null (lifetime). The signed payload is the ONLY authority for entitlement:
 * the unsigned `data` sidecar saved alongside it may restrict but never grant.
 *
 * The verification key is a parameter here so tests can sign with an
 * ephemeral key; production callers go through `validateLicense` in keys.ts,
 * which always binds the embedded public key.
 */

export type LicenseTier = "solo" | "fleet" | "lifetime";

const TIERS: readonly string[] = ["solo", "fleet", "lifetime"];
const B64URL = /^[A-Za-z0-9_-]+$/;

/** Claims taken from a token whose RSA signature verified. */
export interface VerifiedLicenseClaims {
  tier: LicenseTier;
  email: string;
  issuedAt: string;
  expiresAt: string | null;
}

export type LicenseValidation =
  | { valid: true; claims: VerifiedLicenseClaims }
  | { valid: false; reason: string; claims?: VerifiedLicenseClaims };

const TAMPERED = "Invalid license signature — key may be tampered";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseSegment(seg: string): unknown {
  return JSON.parse(Buffer.from(seg, "base64url").toString("utf-8"));
}

function isValidDate(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && Number.isFinite(Date.parse(v));
}

/**
 * Verify a compact RS256 license token and return its signed claims, or a
 * reason string. Never throws.
 */
export function verifyLicenseToken(
  token: unknown,
  publicKey: KeyObject | string
): { ok: true; claims: VerifiedLicenseClaims } | { ok: false; reason: string } {
  try {
    if (typeof token !== "string" || token.length === 0) {
      return { ok: false, reason: "License is not signed — reactivate your key" };
    }
    const parts = token.split(".");
    if (parts.length !== 3 || !parts.every((p) => B64URL.test(p))) {
      return { ok: false, reason: TAMPERED };
    }
    const [h, b, s] = parts;

    const header = parseSegment(h);
    if (
      !isPlainObject(header) ||
      header.alg !== "RS256" ||
      header.typ !== "JWT" ||
      header.product !== "agent-optimizer"
    ) {
      return { ok: false, reason: TAMPERED };
    }

    const key = typeof publicKey === "string" ? createPublicKey(publicKey) : publicKey;
    if (key.asymmetricKeyType !== "rsa") {
      return { ok: false, reason: TAMPERED };
    }
    const sigOk = verify("RSA-SHA256", Buffer.from(`${h}.${b}`), key, Buffer.from(s, "base64url"));
    if (!sigOk) return { ok: false, reason: TAMPERED };

    // Signature is authentic; the payload must still match the issued shape.
    const payload = parseSegment(b);
    if (
      !isPlainObject(payload) ||
      typeof payload.tier !== "string" ||
      !TIERS.includes(payload.tier) ||
      typeof payload.email !== "string" ||
      !isValidDate(payload.issued_at) ||
      !(payload.expires_at === null || isValidDate(payload.expires_at))
    ) {
      return { ok: false, reason: "License token has malformed claims" };
    }

    return {
      ok: true,
      claims: {
        tier: payload.tier as LicenseTier,
        email: payload.email,
        issuedAt: payload.issued_at as string,
        expiresAt: payload.expires_at as string | null,
      },
    };
  } catch {
    return { ok: false, reason: TAMPERED };
  }
}

/**
 * Validate a saved license (token + unsigned sidecar) against `publicKey`.
 * Entitlement comes from the signed claims; the sidecar must agree with them
 * on tier and email, and its expiry (if any) can only shorten validity.
 * Never throws — anything unexpected is invalid.
 */
export function validateLicenseWithKey(
  license: unknown,
  publicKey: KeyObject | string,
  now: Date = new Date()
): LicenseValidation {
  try {
    if (!isPlainObject(license)) {
      return { valid: false, reason: "License file is malformed" };
    }

    const result = verifyLicenseToken(license.signature, publicKey);
    if (!result.ok) return { valid: false, reason: result.reason };
    const { claims } = result;

    const data = license.data;
    if (!isPlainObject(data) || data.tier !== claims.tier || data.email !== claims.email) {
      return {
        valid: false,
        reason: "License data does not match signed claims — key may be tampered",
        claims,
      };
    }

    if (claims.expiresAt !== null) {
      const expires = new Date(claims.expiresAt);
      if (expires.getTime() <= now.getTime()) {
        return { valid: false, reason: `License expired on ${expires.toLocaleDateString()}`, claims };
      }
    }

    // Unsigned sidecar expiry: may only make the license stricter.
    if (data.expiresAt !== undefined && data.expiresAt !== null) {
      if (!isValidDate(data.expiresAt)) {
        return { valid: false, reason: "License data has a malformed expiry", claims };
      }
      const expires = new Date(data.expiresAt);
      if (expires.getTime() <= now.getTime()) {
        return { valid: false, reason: `License expired on ${expires.toLocaleDateString()}`, claims };
      }
    }

    return { valid: true, claims };
  } catch {
    return { valid: false, reason: "License could not be verified" };
  }
}
