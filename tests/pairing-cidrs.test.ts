import { describe, it, expect } from "vitest";
import { auditPairingCidrs, parseCidr } from "../src/auditors/pairing-cidrs.js";
import type { OpenClawConfig } from "../src/types.js";

function makeConfig(cidrs: unknown): OpenClawConfig {
  return {
    gateway: {
      nodes: {
        pairing: {
          autoApproveCidrs: cidrs,
        },
      },
    },
  } as unknown as OpenClawConfig;
}

describe("parseCidr", () => {
  it("parses a basic IPv4 CIDR", () => {
    const c = parseCidr("192.168.1.0/24");
    expect(c).not.toBeNull();
    expect(c!.family).toBe(4);
    expect(c!.prefix).toBe(24);
    expect(c!.bytes).toEqual([192, 168, 1, 0]);
  });

  it("parses 0.0.0.0/0", () => {
    const c = parseCidr("0.0.0.0/0");
    expect(c).not.toBeNull();
    expect(c!.prefix).toBe(0);
  });

  it("parses ::/0", () => {
    const c = parseCidr("::/0");
    expect(c).not.toBeNull();
    expect(c!.family).toBe(6);
    expect(c!.prefix).toBe(0);
  });

  it("parses fe80::/10", () => {
    const c = parseCidr("fe80::/10");
    expect(c).not.toBeNull();
    expect(c!.family).toBe(6);
    expect(c!.bytes[0]).toBe(0xfe);
    expect(c!.bytes[1]).toBe(0x80);
  });

  it("rejects invalid octets", () => {
    expect(parseCidr("256.0.0.1/24")).toBeNull();
    expect(parseCidr("1.2.3/24")).toBeNull();
  });

  it("rejects bare IPs without prefix", () => {
    expect(parseCidr("192.168.1.1")).toBeNull();
  });

  it("rejects non-numeric prefix", () => {
    expect(parseCidr("192.168.1.0/abc")).toBeNull();
  });

  it("rejects out-of-range prefixes", () => {
    expect(parseCidr("192.168.1.0/33")).toBeNull();
    expect(parseCidr("::/129")).toBeNull();
  });
});

describe("auditPairingCidrs", () => {
  it("returns empty when key is absent", () => {
    const results = auditPairingCidrs({} as OpenClawConfig);
    expect(results).toHaveLength(0);
  });

  it("passes on empty array", () => {
    const results = auditPairingCidrs(makeConfig([]));
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("pass");
    expect(results[0].message).toContain("empty");
  });

  it("fails on 0.0.0.0/0", () => {
    const results = auditPairingCidrs(makeConfig(["0.0.0.0/0"]));
    const fail = results.find((r) => r.status === "fail");
    expect(fail).toBeDefined();
    expect(fail!.message).toContain("anywhere on the internet");
  });

  it("fails on ::/0", () => {
    const results = auditPairingCidrs(makeConfig(["::/0"]));
    expect(results.some((r) => r.status === "fail")).toBe(true);
  });

  it("passes on Tailscale CGNAT 100.64.0.0/10", () => {
    const results = auditPairingCidrs(makeConfig(["100.64.0.0/10"]));
    expect(results.some((r) => r.status === "fail" || r.status === "warn")).toBe(false);
    expect(results.some((r) => r.status === "pass")).toBe(true);
  });

  it("passes on RFC1918 192.168.1.0/24", () => {
    const results = auditPairingCidrs(makeConfig(["192.168.1.0/24"]));
    expect(results.some((r) => r.status === "fail" || r.status === "warn")).toBe(false);
  });

  it("passes on canonical 10.0.0.0/8", () => {
    const results = auditPairingCidrs(makeConfig(["10.0.0.0/8"]));
    expect(results.some((r) => r.status === "fail" || r.status === "warn")).toBe(false);
  });

  it("warns on public CIDR like 8.8.8.0/24", () => {
    const results = auditPairingCidrs(makeConfig(["8.8.8.0/24"]));
    const warn = results.find((r) => r.status === "warn");
    expect(warn).toBeDefined();
    expect(warn!.message).toContain("public IP range");
  });

  it("warns on overly wide non-canonical private CIDR like 172.16.0.0/12 — actually canonical RFC1918 so passes", () => {
    // 172.16.0.0/12 is canonical RFC1918 — should not warn
    const results = auditPairingCidrs(makeConfig(["172.16.0.0/12"]));
    expect(results.some((r) => r.status === "warn")).toBe(false);
  });

  it("warns on unusually wide IPv6 prefix", () => {
    // fc00::/7 is the ULA range — covered by isPrivateV6, but /7 is wider than /56
    const results = auditPairingCidrs(makeConfig(["fc00::/7"]));
    expect(results.some((r) => r.status === "warn")).toBe(true);
  });

  it("fails on non-string entries", () => {
    const results = auditPairingCidrs(makeConfig([42, null, "10.0.0.0/8"]));
    const fails = results.filter((r) => r.status === "fail");
    expect(fails.length).toBe(2);
  });

  it("fails on garbage strings", () => {
    const results = auditPairingCidrs(makeConfig(["not-a-cidr"]));
    expect(results.some((r) => r.status === "fail")).toBe(true);
  });

  it("fails on non-array shape", () => {
    const results = auditPairingCidrs(makeConfig("10.0.0.0/8"));
    const fail = results.find((r) => r.check === "autoApproveCidrs shape");
    expect(fail).toBeDefined();
    expect(fail!.status).toBe("fail");
  });

  it("flags multiple issues independently", () => {
    const results = auditPairingCidrs(
      makeConfig(["0.0.0.0/0", "8.8.8.0/24", "192.168.1.0/24"])
    );
    expect(results.some((r) => r.message.includes("anywhere on the internet"))).toBe(true);
    expect(results.some((r) => r.message.includes("public IP range"))).toBe(true);
  });
});
