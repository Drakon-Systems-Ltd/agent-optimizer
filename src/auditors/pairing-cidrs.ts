import type { AuditResult, OpenClawConfig } from "../types.js";

interface ParsedCidr {
  family: 4 | 6;
  prefix: number;
  bytes: number[];
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIpv4(s: string): number[] | null {
  const m = IPV4_RE.exec(s);
  if (!m) return null;
  const bytes = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  for (const b of bytes) if (b < 0 || b > 255 || !Number.isInteger(b)) return null;
  return bytes;
}

function parseIpv6(s: string): number[] | null {
  if (!s.includes(":")) return null;
  let head = s, tail = "";
  if (s.includes("::")) {
    const parts = s.split("::");
    if (parts.length !== 2) return null;
    head = parts[0];
    tail = parts[1];
  }
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const fillCount = 8 - headGroups.length - tailGroups.length;
  if (fillCount < 0) return null;
  const fill = Array(fillCount).fill("0");
  const all = [...headGroups, ...fill, ...tailGroups];
  if (all.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of all) {
    if (g === "" || g.length > 4 || !/^[0-9a-fA-F]+$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes;
}

export function parseCidr(input: string): ParsedCidr | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s) return null;
  const slash = s.indexOf("/");
  if (slash === -1) return null;
  const addr = s.slice(0, slash);
  const prefixStr = s.slice(slash + 1);
  if (!/^\d+$/.test(prefixStr)) return null;
  const prefix = Number(prefixStr);

  const v4 = parseIpv4(addr);
  if (v4) {
    if (prefix < 0 || prefix > 32) return null;
    return { family: 4, prefix, bytes: v4 };
  }
  const v6 = parseIpv6(addr);
  if (v6) {
    if (prefix < 0 || prefix > 128) return null;
    return { family: 6, prefix, bytes: v6 };
  }
  return null;
}

function inRange(bytes: number[], range: { start: number[]; prefix: number }): boolean {
  const fullBytes = Math.floor(range.prefix / 8);
  const remBits = range.prefix % 8;
  for (let i = 0; i < fullBytes; i++) {
    if (bytes[i] !== range.start[i]) return false;
  }
  if (remBits === 0) return true;
  const mask = 0xff << (8 - remBits) & 0xff;
  return (bytes[fullBytes] & mask) === (range.start[fullBytes] & mask);
}

const PRIVATE_V4_RANGES = [
  { start: [10, 0, 0, 0], prefix: 8 },        // RFC1918
  { start: [172, 16, 0, 0], prefix: 12 },     // RFC1918
  { start: [192, 168, 0, 0], prefix: 16 },    // RFC1918
  { start: [127, 0, 0, 0], prefix: 8 },       // loopback
  { start: [169, 254, 0, 0], prefix: 16 },    // link-local
  { start: [100, 64, 0, 0], prefix: 10 },     // CGNAT / Tailscale
];

function isPrivateV4(cidr: ParsedCidr): boolean {
  return PRIVATE_V4_RANGES.some((r) => inRange(cidr.bytes, r));
}

function isPrivateV6(cidr: ParsedCidr): boolean {
  // ::1 (loopback)
  if (cidr.bytes.every((b, i) => (i === 15 ? b === 1 : b === 0))) return true;
  // fc00::/7 — ULA
  if ((cidr.bytes[0] & 0xfe) === 0xfc) return true;
  // fe80::/10 — link-local
  if (cidr.bytes[0] === 0xfe && (cidr.bytes[1] & 0xc0) === 0x80) return true;
  return false;
}

function isUnspecified(cidr: ParsedCidr): boolean {
  return cidr.bytes.every((b) => b === 0);
}

export function auditPairingCidrs(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];
  const gateway = config.gateway as Record<string, unknown> | undefined;
  const nodes = gateway?.nodes as Record<string, unknown> | undefined;
  const pairing = nodes?.pairing as Record<string, unknown> | undefined;
  const raw = pairing?.autoApproveCidrs;

  if (raw === undefined) {
    return results;
  }

  if (!Array.isArray(raw)) {
    results.push({
      category: "Pairing CIDRs",
      check: "autoApproveCidrs shape",
      status: "fail",
      message: "gateway.nodes.pairing.autoApproveCidrs must be a string array",
      fix: "Set autoApproveCidrs to an array of CIDR strings, e.g. [\"100.64.0.0/10\"]",
    });
    return results;
  }

  if (raw.length === 0) {
    results.push({
      category: "Pairing CIDRs",
      check: "autoApproveCidrs",
      status: "pass",
      message: "autoApproveCidrs is empty — device pairing requires explicit approval",
    });
    return results;
  }

  let saw0000 = false;
  let sawPublic = false;
  let sawWide = false;
  let sawInvalid = false;
  const valid: ParsedCidr[] = [];

  for (const entry of raw) {
    if (typeof entry !== "string") {
      sawInvalid = true;
      results.push({
        category: "Pairing CIDRs",
        check: "Invalid CIDR entry",
        status: "fail",
        message: `autoApproveCidrs contains a non-string entry: ${JSON.stringify(entry)}`,
        fix: "Remove the entry or replace with a valid CIDR string",
      });
      continue;
    }
    const parsed = parseCidr(entry);
    if (!parsed) {
      sawInvalid = true;
      results.push({
        category: "Pairing CIDRs",
        check: `Invalid CIDR "${entry}"`,
        status: "fail",
        message: `"${entry}" is not a parseable CIDR`,
        fix: "Use the form a.b.c.d/prefix (IPv4) or addr/prefix (IPv6)",
      });
      continue;
    }
    valid.push(parsed);

    // 0.0.0.0/0 or ::/0
    if (isUnspecified(parsed) && parsed.prefix === 0) {
      saw0000 = true;
      results.push({
        category: "Pairing CIDRs",
        check: `Open-internet CIDR "${entry}"`,
        status: "fail",
        message: `"${entry}" auto-approves device pairing from anywhere on the internet — any node can join your gateway without user approval`,
        fix: "Restrict to your private network range (e.g. 100.64.0.0/10 for Tailscale, 192.168.0.0/16 for LAN), or remove and pair manually",
      });
      continue;
    }

    const isPrivate = parsed.family === 4 ? isPrivateV4(parsed) : isPrivateV6(parsed);

    if (!isPrivate) {
      sawPublic = true;
      results.push({
        category: "Pairing CIDRs",
        check: `Public CIDR "${entry}"`,
        status: "warn",
        message: `"${entry}" is a public IP range — any node from this range can auto-pair without approval`,
        fix: "Confirm this range is under your control. Prefer Tailscale CGNAT (100.64.0.0/10) or RFC1918 ranges",
      });
      continue;
    }

    // Private but check for unusually wide prefixes
    const tooWide = parsed.family === 4 ? parsed.prefix < 16 : parsed.prefix < 56;
    // Whitelist canonical RFC1918 / Tailscale ranges that are wider than /16 but still safely scoped:
    //   10.0.0.0/8, 172.16.0.0/12 (RFC1918), 100.64.0.0/10 (Tailscale CGNAT)
    const isCanonicalWide =
      (parsed.family === 4 && parsed.prefix === 8 && parsed.bytes[0] === 10) ||
      (parsed.family === 4 && parsed.prefix === 10 && parsed.bytes[0] === 100 && parsed.bytes[1] === 64) ||
      (parsed.family === 4 && parsed.prefix === 12 && parsed.bytes[0] === 172 && parsed.bytes[1] === 16);
    if (tooWide && !isCanonicalWide) {
      sawWide = true;
      results.push({
        category: "Pairing CIDRs",
        check: `Wide CIDR "${entry}"`,
        status: "warn",
        message: `"${entry}" covers an unusually large address range (/<16 IPv4 or /<56 IPv6) — narrow it if possible`,
        fix: "Use the smallest CIDR that covers the nodes you actually want to auto-pair",
      });
    }
  }

  if (!saw0000 && !sawPublic && !sawWide && !sawInvalid && valid.length > 0) {
    results.push({
      category: "Pairing CIDRs",
      check: "autoApproveCidrs",
      status: "pass",
      message: `${valid.length} CIDR(s) configured — all private and reasonably scoped`,
    });
  }

  return results;
}
