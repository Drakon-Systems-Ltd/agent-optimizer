import { createHmac, randomBytes } from "crypto";

const SIGNING_SECRET = "drakon-agent-optimizer-2026";

export interface LicenseData {
  email: string;
  tier: "solo" | "fleet" | "lifetime";
  issuedAt: string;
  expiresAt: string | null; // null = lifetime
  stripePaymentId: string;
}

export interface License {
  key: string;
  data: LicenseData;
  signature: string;
}

/**
 * Generate a license key from payment data.
 * Format: AO-TIER-XXXXXXXX-XXXXXXXX
 */
export function generateLicenseKey(tier: string): string {
  const prefix = tier.toUpperCase().slice(0, 4);
  const part1 = randomBytes(4).toString("hex").toUpperCase();
  const part2 = randomBytes(4).toString("hex").toUpperCase();
  return `AO-${prefix}-${part1}-${part2}`;
}

/**
 * Sign license data to prevent tampering.
 */
export function signLicense(data: LicenseData): string {
  const payload = JSON.stringify(data);
  return createHmac("sha256", SIGNING_SECRET).update(payload).digest("hex");
}

/**
 * Verify a license signature.
 */
export function verifySignature(data: LicenseData, signature: string): boolean {
  const expected = signLicense(data);
  return expected === signature;
}

/**
 * Create a full license object from payment data.
 */
export function createLicense(
  email: string,
  tier: "solo" | "fleet" | "lifetime",
  stripePaymentId: string
): License {
  const now = new Date();
  const expiresAt =
    tier === "lifetime"
      ? null
      : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const data: LicenseData = {
    email,
    tier,
    issuedAt: now.toISOString(),
    expiresAt,
    stripePaymentId,
  };

  return {
    key: generateLicenseKey(tier),
    data,
    signature: signLicense(data),
  };
}

/**
 * Check if a license is valid and not expired.
 */
export function validateLicense(license: License): {
  valid: boolean;
  reason?: string;
} {
  // Verify signature
  if (!verifySignature(license.data, license.signature)) {
    return { valid: false, reason: "Invalid license signature — key may be tampered" };
  }

  // Check expiry
  if (license.data.expiresAt) {
    const expires = new Date(license.data.expiresAt);
    if (expires < new Date()) {
      return {
        valid: false,
        reason: `License expired on ${expires.toLocaleDateString()}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Check if a license tier allows fleet commands.
 */
export function canUseFleet(tier: string): boolean {
  return tier === "fleet" || tier === "lifetime";
}
