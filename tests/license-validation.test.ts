import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { validateLicense } from "../src/licensing/keys.js";
import { validateLicenseWithKey, verifyLicenseToken } from "../src/licensing/verify.js";
import { issueLicense, signToken, testKeyPair, ISSUER_HEADER } from "./helpers/license-fixtures.js";

// Ephemeral keys only — the production private key is never available here.
const ISSUER = testKeyPair();
const ATTACKER = testKeyPair();

const DAY = 24 * 60 * 60 * 1000;
const future = () => new Date(Date.now() + 30 * DAY).toISOString();
const past = () => new Date(Date.now() - DAY).toISOString();

function unsigned(signature: unknown, data: Record<string, unknown> = {}) {
  return {
    key: "AO-LIFE-DEADBEEF-CAFEBABE",
    data: {
      email: "x@example.com",
      tier: "lifetime",
      issuedAt: new Date().toISOString(),
      expiresAt: null,
      stripePaymentId: "x",
      ...data,
    },
    signature,
  };
}

function payloadOf(token: string) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
}

describe("validateLicense (embedded production key) — unsigned/forged input is never valid", () => {
  const cases: Array<[string, unknown]> = [
    ["missing signature", undefined],
    ["null signature", null],
    ["empty signature", ""],
    ["non-JWT signature", "offline"],
    ["numeric signature", 42],
    ["two-part dotted", "a.b"],
    ["three-part garbage", "a.b.c"],
    ["four-part", "a.b.c.d"],
    ["non-base64url chars", "eyJ@.eyJ.abc"],
  ];
  for (const [name, sig] of cases) {
    it(`rejects ${name}`, () => {
      const r = validateLicense(unsigned(sig) as never);
      expect(r.valid).toBe(false);
    });
  }

  it("rejects a token signed with a key other than the embedded one", () => {
    const lic = issueLicense(ATTACKER.privateKey, { tier: "lifetime" });
    expect(validateLicense(lic as never).valid).toBe(false);
  });

  it("rejects alg=none even with an empty signature segment", () => {
    const body = Buffer.from(JSON.stringify({ tier: "lifetime", email: "x@example.com", issued_at: new Date().toISOString(), expires_at: null })).toString("base64url");
    const head = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT", product: "agent-optimizer" })).toString("base64url");
    expect(validateLicense(unsigned(`${head}.${body}.`) as never).valid).toBe(false);
  });

  it("does not throw on structurally malformed licenses", () => {
    for (const bad of [null, undefined, 5, "x", [], {}, { signature: "a.b.c" }, { data: null, signature: "" }]) {
      expect(() => validateLicense(bad as never)).not.toThrow();
      expect(validateLicense(bad as never).valid).toBe(false);
    }
  });
});

describe("validateLicenseWithKey — signed claims are authoritative", () => {
  const validate = (lic: unknown) => validateLicenseWithKey(lic, ISSUER.publicKey);

  it("accepts a genuine issuer-shaped solo license and returns its signed claims", () => {
    const lic = issueLicense(ISSUER.privateKey, { tier: "solo", email: "a@b.co" });
    const r = validate(lic);
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.claims.tier).toBe("solo");
      expect(r.claims.email).toBe("a@b.co");
      expect(r.claims.expiresAt).toBe(lic.data.expiresAt);
    }
  });

  it("accepts genuine fleet and lifetime (null expiry) licenses", () => {
    expect(validate(issueLicense(ISSUER.privateKey, { tier: "fleet" })).valid).toBe(true);
    const life = validate(issueLicense(ISSUER.privateKey, { tier: "lifetime" }));
    expect(life.valid).toBe(true);
    if (life.valid) expect(life.claims.expiresAt).toBeNull();
  });

  it("accepts a PEM string key as well as a KeyObject", () => {
    expect(validateLicenseWithKey(issueLicense(ISSUER.privateKey), ISSUER.publicPem).valid).toBe(true);
  });

  it("accepts a sidecar with no expiresAt field (Stripe fallback without ao_expires_at)", () => {
    const lic = issueLicense(ISSUER.privateKey);
    delete (lic.data as Record<string, unknown>).expiresAt;
    expect(validate(lic).valid).toBe(true);
  });

  it("accepts a sidecar expiry that differs from the signed one when both are in the future", () => {
    // Issuer re-signs at activation (expires_at = now+365d) while the sidecar
    // carries the purchase expiry — they legitimately differ.
    const lic = issueLicense(ISSUER.privateKey);
    lic.data.expiresAt = future();
    expect(validate(lic).valid).toBe(true);
  });

  it("rejects a genuinely expired signed license", () => {
    const lic = issueLicense(ISSUER.privateKey, { expiresAt: past() });
    const r = validate(lic);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/expired/i);
  });

  it("an expired signed license stays expired when the sidecar expiry is nulled or extended", () => {
    for (const edit of [null, "2099-01-01T00:00:00.000Z", undefined]) {
      const lic = issueLicense(ISSUER.privateKey, { expiresAt: past() });
      (lic.data as Record<string, unknown>).expiresAt = edit;
      expect(validate(lic).valid).toBe(false);
    }
  });

  it("an expired sidecar expiry still restricts a signed-valid license", () => {
    const lic = issueLicense(ISSUER.privateKey);
    lic.data.expiresAt = past();
    expect(validate(lic).valid).toBe(false);
  });

  it("rejects a malformed sidecar expiry", () => {
    const lic = issueLicense(ISSUER.privateKey);
    (lic.data as Record<string, unknown>).expiresAt = "not-a-date";
    expect(validate(lic).valid).toBe(false);
    (lic.data as Record<string, unknown>).expiresAt = 12345;
    expect(validate(lic).valid).toBe(false);
  });

  it("rejects an edited unsigned tier (solo → fleet/lifetime)", () => {
    for (const tier of ["fleet", "lifetime"]) {
      const lic = issueLicense(ISSUER.privateKey, { tier: "solo" });
      (lic.data as Record<string, unknown>).tier = tier;
      const r = validate(lic);
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.reason).toMatch(/does not match signed claims/);
    }
  });

  it("rejects an edited unsigned email", () => {
    const lic = issueLicense(ISSUER.privateKey);
    lic.data.email = "someone-else@example.com";
    expect(validate(lic).valid).toBe(false);
  });

  it("rejects a missing or non-object sidecar", () => {
    const lic = issueLicense(ISSUER.privateKey) as Record<string, unknown>;
    expect(validate({ ...lic, data: undefined }).valid).toBe(false);
    expect(validate({ ...lic, data: "solo" }).valid).toBe(false);
  });

  it("rejects a tampered signed payload (tier upgraded, original signature kept)", () => {
    const lic = issueLicense(ISSUER.privateKey, { tier: "solo" });
    const [h, , s] = lic.signature.split(".");
    const p = payloadOf(lic.signature);
    const forged = Buffer.from(JSON.stringify({ ...p, tier: "lifetime", expires_at: null })).toString("base64url");
    lic.signature = `${h}.${forged}.${s}`;
    lic.data.tier = "lifetime";
    lic.data.expiresAt = null;
    expect(validate(lic).valid).toBe(false);
  });

  it("rejects a tampered signature segment", () => {
    const lic = issueLicense(ISSUER.privateKey);
    const [h, b, s] = lic.signature.split(".");
    const flipped = (s[0] === "A" ? "B" : "A") + s.slice(1);
    lic.signature = `${h}.${b}.${flipped}`;
    expect(validate(lic).valid).toBe(false);
  });

  it("rejects a truncated signature segment", () => {
    const lic = issueLicense(ISSUER.privateKey);
    lic.signature = lic.signature.slice(0, -10);
    expect(validate(lic).valid).toBe(false);
  });

  it("rejects a token signed by another key", () => {
    expect(validate(issueLicense(ATTACKER.privateKey)).valid).toBe(false);
  });

  it("rejects headers that deviate from the issuer contract, even when validly signed", () => {
    const payload = payloadOf(issueLicense(ISSUER.privateKey).signature);
    for (const header of [
      { ...ISSUER_HEADER, alg: "HS256" },
      { ...ISSUER_HEADER, alg: "none" },
      { ...ISSUER_HEADER, product: "ekho-pro" },
      { alg: "RS256", typ: "JWT" },
      { ...ISSUER_HEADER, typ: "JWS" },
      "RS256",
    ]) {
      const lic = issueLicense(ISSUER.privateKey);
      lic.signature = signToken(ISSUER.privateKey, payload, header);
      expect(validate(lic).valid).toBe(false);
    }
  });

  it("rejects validly signed payloads with malformed claims", () => {
    const base = payloadOf(issueLicense(ISSUER.privateKey).signature);
    for (const payload of [
      { ...base, tier: "enterprise" },
      { ...base, tier: undefined },
      { ...base, email: 7 },
      { ...base, issued_at: "yesterday" },
      { ...base, issued_at: undefined },
      { ...base, expires_at: "never" },
      { ...base, expires_at: undefined },
      { ...base, expires_at: 0 },
      [base],
      "solo",
      null,
    ]) {
      const r = verifyLicenseToken(signToken(ISSUER.privateKey, payload), ISSUER.publicKey);
      expect(r.ok).toBe(false);
    }
  });

  it("rejects a validly signed token whose segments are not JSON", () => {
    const h = Buffer.from("not json").toString("base64url");
    const b = Buffer.from("{").toString("base64url");
    const sig = signToken(ISSUER.privateKey, {}).split(".")[2];
    expect(verifyLicenseToken(`${h}.${b}.${sig}`, ISSUER.publicKey).ok).toBe(false);
  });

  it("returns invalid (not throw) for a non-RSA or unusable key", () => {
    const lic = issueLicense(ISSUER.privateKey);
    expect(() => validateLicenseWithKey(lic, "not a pem")).not.toThrow();
    expect(validateLicenseWithKey(lic, "not a pem").valid).toBe(false);
  });
});

// ── Store + CLI boundaries (temp HOME; never the real ~/.agent-optimizer) ──
describe("license store on invalid input", () => {
  let HOME: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    HOME = mkdtempSync(join(tmpdir(), "ao-license-store-"));
    prevHome = process.env.HOME;
    process.env.HOME = HOME;
    vi.resetModules();
  });
  afterEach(() => {
    process.env.HOME = prevHome;
    rmSync(HOME, { recursive: true, force: true });
  });

  async function store() {
    return import("../src/licensing/store.js");
  }

  function writeRaw(body: string) {
    const dir = join(HOME, ".agent-optimizer");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "license.json"), body);
  }

  it("resolves the license path under the temp HOME", async () => {
    const s = await store();
    expect(s.getLicensePath().startsWith(HOME)).toBe(true);
  });

  it("loadLicense returns null for structurally malformed files", async () => {
    for (const body of ["", "{", "null", "5", '"x"', "[]", "{}", '{"key":"k","data":null,"signature":""}', '{"key":"k","data":{},"signature":1}']) {
      writeRaw(body);
      const s = await store();
      expect(s.loadLicense()).toBeNull();
    }
  });

  it("a loaded unsigned license is rejected by validateLicense", async () => {
    writeRaw(JSON.stringify(unsigned("offline")));
    const s = await store();
    const lic = s.loadLicense();
    expect(lic).not.toBeNull();
    expect(validateLicense(lic!).valid).toBe(false);
  });

  it("removeLicense deletes the file (no ESM require crash)", async () => {
    writeRaw(JSON.stringify(unsigned("offline")));
    const s = await store();
    expect(s.removeLicense()).toBe(true);
    expect(existsSync(s.getLicensePath())).toBe(false);
    expect(s.removeLicense()).toBe(false);
  });
});

describe("cli license gates (spawned, temp HOME, no network)", () => {
  const CLI = join(process.cwd(), "src", "cli.ts");
  const LOADER = join(process.cwd(), "tests", "helpers", "license-key-loader.mjs");
  let HOME: string;
  let testKeyB64: string;

  beforeAll(() => {
    testKeyB64 = Buffer.from(ISSUER.publicPem).toString("base64");
  });
  beforeEach(() => {
    HOME = mkdtempSync(join(tmpdir(), "ao-license-cli-"));
  });
  afterEach(() => {
    rmSync(HOME, { recursive: true, force: true });
  });

  // withTestKey: the test-only loader swaps the embedded key for ISSUER's, so
  // genuinely signed fixtures can reach the licensed path. Without it the
  // production key is in force.
  function runCli(args: string[], withTestKey = false) {
    const nodeArgs = ["--import", "tsx", ...(withTestKey ? ["--import", LOADER] : []), CLI, ...args];
    const env: NodeJS.ProcessEnv = { ...process.env, HOME, NO_COLOR: "1", FORCE_COLOR: "0" };
    if (withTestKey) env.AO_TEST_LICENSE_PUBKEY_B64 = testKeyB64;
    else delete env.AO_TEST_LICENSE_PUBKEY_B64;
    return spawnSync(process.execPath, nodeArgs, {
      encoding: "utf-8",
      cwd: process.cwd(),
      env,
      timeout: 20000,
      killSignal: "SIGKILL",
    });
  }

  function install(lic: unknown) {
    const dir = join(HOME, ".agent-optimizer");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "license.json"), typeof lic === "string" ? lic : JSON.stringify(lic));
  }

  it("unsigned lifetime license: `license` shows invalid, Fleet No", () => {
    install(unsigned(""));
    const r = runCli(["license"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Status\s+License is not signed/);
    expect(r.stdout).toMatch(/Fleet\s+No/);
    expect(r.stdout).not.toMatch(/Status\s+Valid/);
  }, 30_000);

  it("unsigned lifetime license: `fleet` is refused with exit 1", () => {
    install(unsigned("offline"));
    const r = runCli(["fleet", "--hosts", "h1"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("requires a license");
  }, 30_000);

  it("ephemeral-key-signed license is refused under the production key", () => {
    install(issueLicense(ISSUER.privateKey, { tier: "fleet" }));
    const r = runCli(["fleet", "--hosts", "h1"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("requires a license");
  }, 30_000);

  it("corrupt license file does not crash `license`", () => {
    install("[1,2,3]");
    const r = runCli(["license"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("No license installed");
  }, 30_000);

  it("license with non-string sidecar fields does not crash `license`", () => {
    install(unsigned("x", { tier: 5, email: null, expiresAt: {} }));
    const r = runCli(["license"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Fleet\s+No/);
  }, 30_000);

  it("test key seam: a genuine signed fleet license shows Valid + Fleet Yes", () => {
    install(issueLicense(ISSUER.privateKey, { tier: "fleet" }));
    const r = runCli(["license"], true);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Status\s+Valid/);
    expect(r.stdout).toMatch(/Fleet\s+Yes/);
  }, 30_000);

  it("signed solo license with sidecar tier edited to lifetime: invalid, Fleet No, fleet refused", () => {
    const lic = issueLicense(ISSUER.privateKey, { tier: "solo" });
    (lic.data as Record<string, unknown>).tier = "lifetime";
    install(lic);
    const status = runCli(["license"], true);
    expect(status.stdout).toMatch(/does not match signed/);
    expect(status.stdout).toMatch(/Fleet\s+No/);
    const fleet = runCli(["fleet", "--hosts", "h1"], true);
    expect(fleet.status).toBe(1);
  }, 30_000);

  it("signed solo license: fleet refused on tier, from signed claims", () => {
    install(issueLicense(ISSUER.privateKey, { tier: "solo" }));
    const r = runCli(["fleet", "--hosts", "h1"], true);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("requires a Fleet or Lifetime license");
    expect(r.stdout).toContain("Current license: solo");
  }, 30_000);

  it("signed but expired license: `license` reports expired", () => {
    install(issueLicense(ISSUER.privateKey, { tier: "fleet", expiresAt: past() }));
    const r = runCli(["license"], true);
    expect(r.stdout).toMatch(/Status\s+License expired/);
    expect(r.stdout).toMatch(/Fleet\s+No/);
  }, 30_000);
});
