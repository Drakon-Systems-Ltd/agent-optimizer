import { generateKeyPairSync, sign, type KeyObject } from "crypto";

/**
 * TEST-ONLY license fixtures. Every key here is generated per process and
 * never leaves it; nothing in this file is reachable from production code.
 */

export const ISSUER_HEADER = { alg: "RS256", typ: "JWT", product: "agent-optimizer" };

export function testKeyPair(): { publicKey: KeyObject; privateKey: KeyObject; publicPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    publicKey,
    privateKey,
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

/** Sign a compact RS256 token exactly as drakonsystems.com's issuer does. */
export function signToken(privateKey: KeyObject, payload: unknown, header: unknown = ISSUER_HEADER): string {
  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  const sig = sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  return `${signingInput}.${sig}`;
}

export interface IssueOpts {
  tier?: "solo" | "fleet" | "lifetime";
  email?: string;
  expiresAt?: string | null;
  issuedAt?: string;
}

/** A license.json body in the shape /api/agent-optimizer/activate returns. */
export function issueLicense(privateKey: KeyObject, opts: IssueOpts = {}) {
  const tier = opts.tier ?? "solo";
  const email = opts.email ?? "t@example.com";
  const issuedAt = opts.issuedAt ?? new Date().toISOString();
  const expiresAt =
    opts.expiresAt !== undefined
      ? opts.expiresAt
      : tier === "lifetime"
        ? null
        : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const payload = {
    tier,
    email,
    features: tier === "solo" ? ["audit", "optimize", "scan"] : ["audit", "optimize", "scan", "fleet"],
    issued_at: issuedAt,
    expires_at: expiresAt,
  };
  return {
    key: `AO-${tier.toUpperCase().slice(0, 4)}-DEADBEEF-CAFEBABE`,
    data: { email, tier, issuedAt, expiresAt, stripePaymentId: "pi_test" },
    signature: signToken(privateKey, payload),
  };
}
