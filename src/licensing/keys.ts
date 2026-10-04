import { randomBytes } from "crypto";
import { validateLicenseWithKey, type LicenseValidation } from "./verify.js";

export type { LicenseValidation, VerifiedLicenseClaims } from "./verify.js";

// Embedded public key for offline license verification
const PUBLIC_KEY_B64 =
  "LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUFvblVPUjQ3U3ZsdkdNbW9UQ2J4Zwp5NlFkSVlmSmQ4Sm96cnVhNHZhcHh6aFlTT21rQWJJdW5oZDB5Y3owdEZyN3dYYlUvUlJkenM3eXFOK09LNTJiClZ0V0hzdHpBcE5PbkJ1ZWpWYTdneEY3TjBwRHA5a0QyN3ZCWFpRa1pKWVVibTJGc3ZBNC9oNG9qUmtBS3V6S3EKWkxOdlVpdWtsVklxRU1jV21Od0U0K3ZMcUoxT0ZtYWRTS2RyU0V3cWp0Q0F3RzFjNFRtcTdHRUdXRWtQNnRFWAphdEtlM3I2V05SOEh5V2ZFUFhVbjkrSmlhOG02Y08zZGZ6THE2Z3hrRi9yM1JDVXdjWWs0anBqS040cmpaakROCmJOVHl5Tk1RYUhybVRmYjBqRHRNaGgza0RuRFVCdE0vbGlyejdQbExFbnl5N3hkVHNCRUpmKzlzNXc2WGxaQngKUXdJREFRQUIKLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tCg==";

const PUBLIC_KEY_PEM = Buffer.from(PUBLIC_KEY_B64, "base64").toString("utf-8");

export interface LicenseData {
  email: string;
  tier: "solo" | "fleet" | "lifetime";
  issuedAt: string;
  expiresAt: string | null;
  stripePaymentId: string;
}

export interface License {
  key: string;
  data: LicenseData;
  signature: string; // RSA-signed JWT from server
}

/**
 * Generate a license key format for display.
 * Format: AO-TIER-XXXXXXXX-XXXXXXXX
 */
export function generateLicenseKey(tier: string): string {
  const prefix = tier.toUpperCase().slice(0, 4);
  const part1 = randomBytes(4).toString("hex").toUpperCase();
  const part2 = randomBytes(4).toString("hex").toUpperCase();
  return `AO-${prefix}-${part1}-${part2}`;
}

/**
 * Check if a license is authentic, consistent and not expired.
 *
 * The signature must be an RS256 JWT issued by the licensing server and
 * verified against the embedded public key — there is no unsigned fallback.
 * On success `claims` holds the signed tier/email/expiry; callers must take
 * entitlement from `claims`, not from the unsigned `license.data` sidecar.
 * Never throws: malformed input is reported as invalid.
 */
export function validateLicense(license: License): LicenseValidation {
  return validateLicenseWithKey(license, PUBLIC_KEY_PEM);
}

/**
 * Check if a license tier allows fleet commands.
 */
export function canUseFleet(tier: string): boolean {
  return tier === "fleet" || tier === "lifetime";
}
