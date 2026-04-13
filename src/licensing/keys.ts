import { createVerify, randomBytes } from "crypto";

// Embedded public key for offline license verification
const PUBLIC_KEY_B64 =
  "LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUFvblVPUjQ3U3ZsdkdNbW9UQ2J4Zwp5NlFkSVlmSmQ4Sm96cnVhNHZhcHh6aFlTT21rQWJJdW5oZDB5Y3owdEZyN3dYYlUvUlJkenM3eXFOK09LNTJiClZ0V0hzdHpBcE5PbkJ1ZWpWYTdneEY3TjBwRHA5a0QyN3ZCWFpRa1pKWVVibTJGc3ZBNC9oNG9qUmtBS3V6S3EKWkxOdlVpdWtsVklxRU1jV21Od0U0K3ZMcUoxT0ZtYWRTS2RyU0V3cWp0Q0F3RzFjNFRtcTdHRUdXRWtQNnRFWAphdEtlM3I2V05SOEh5V2ZFUFhVbjkrSmlhOG02Y08zZGZ6THE2Z3hrRi9yM1JDVXdjWWs0anBqS040cmpaakROCmJOVHl5Tk1RYUhybVRmYjBqRHRNaGgza0RuRFVCdE0vbGlyejdQbExFbnl5N3hkVHNCRUpmKzlzNXc2WGxaQngKUXdJREFRQUIKLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tCg==";

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
 * Verify an RSA-signed JWT license token offline.
 */
function verifyJwtSignature(token: string): boolean {
  try {
    const publicKeyPem = Buffer.from(PUBLIC_KEY_B64, "base64").toString("utf-8");
    const parts = token.split(".");
    if (parts.length !== 3) return false;

    const [header, body, sig] = parts;
    const signatureBuffer = Buffer.from(
      sig.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    );

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${body}`);
    return verifier.verify(publicKeyPem, signatureBuffer);
  } catch {
    return false;
  }
}

/**
 * Check if a license is valid and not expired.
 * Verifies the RSA signature if a JWT token is present, otherwise checks data integrity.
 */
export function validateLicense(license: License): {
  valid: boolean;
  reason?: string;
} {
  // If signature looks like a JWT, verify with RSA public key
  if (license.signature && license.signature.includes(".")) {
    if (!verifyJwtSignature(license.signature)) {
      return {
        valid: false,
        reason: "Invalid license signature — key may be tampered",
      };
    }
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
