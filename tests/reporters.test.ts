import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateReport, printScanResults } from "../src/reporters/index.js";
import type { AuditReport, AuditResult } from "../src/types.js";

function report(results: AuditResult[]): AuditReport {
  const pass = results.filter((r) => r.status === "pass").length;
  const warn = results.filter((r) => r.status === "warn").length;
  const fail = results.filter((r) => r.status === "fail").length;
  return {
    schemaVersion: 1,
    timestamp: "2026-06-15T00:00:00Z",
    host: "h",
    systems: [],
    openclawVersion: "2026.6.6",
    results,
    summary: { total: results.length, pass, warn, fail },
  };
}

const LONG_MSG =
  "contextTokens is set to one million which is very large and burns a great many tokens on every single turn of the conversation";

const SAMPLE: AuditResult[] = [
  { category: "Model Config", check: "thinkingDefault", status: "fail", message: "Invalid value will crash the gateway", fix: "agent-optimizer audit --fix" },
  { category: "Token Efficiency", check: "context window", status: "warn", message: LONG_MSG, fix: "reduce to 200K" },
  { category: "Memory Search", check: "ShieldCortex", status: "info", message: "ShieldCortex detected" },
  { category: "Bootstrap Files", check: "SOUL.md size", status: "pass", message: "4.6K (23% of limit)" },
];

describe("generateReport", () => {
  let out: string;
  beforeEach(() => {
    out = "";
    vi.spyOn(console, "log").mockImplementation((...args) => {
      out += args.join(" ") + "\n";
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("emits JSON and nothing else in json mode", () => {
    generateReport(report(SAMPLE), { json: true });
    const parsed = JSON.parse(out);
    expect(parsed.summary.total).toBe(4);
    // schemaVersion flows straight through the JSON reporter to `audit --json`.
    expect(parsed.schemaVersion).toBe(1);
  });

  it("uses shape-distinct status symbols", () => {
    generateReport(report(SAMPLE), { licensed: true });
    expect(out).toContain("✗"); // fail
    expect(out).toContain("⚠"); // warn
    expect(out).toContain("✓"); // pass
  });

  it("leads with a NEEDS ATTENTION section containing fails and warns", () => {
    generateReport(report(SAMPLE), { licensed: true });
    const idxAttention = out.indexOf("NEEDS ATTENTION");
    const idxPassed = out.indexOf("passed:");
    expect(idxAttention).toBeGreaterThanOrEqual(0);
    // fails/warns appear before the passed summary
    expect(idxAttention).toBeLessThan(idxPassed);
  });

  it("wraps long messages instead of truncating them with an ellipsis", () => {
    generateReport(report(SAMPLE), { licensed: true });
    expect(out).not.toContain("…");
    // every word of the long message survives (nothing clipped)
    for (const word of LONG_MSG.split(" ")) expect(out).toContain(word);
  });

  it("shows fix text for fails/warns when licensed", () => {
    generateReport(report(SAMPLE), { licensed: true });
    expect(out).toContain("agent-optimizer audit --fix");
    expect(out).toContain("reduce to 200K");
  });

  it("condenses passes into a single passed list", () => {
    generateReport(report(SAMPLE), { licensed: true });
    expect(out).toContain("1 passed:");
    expect(out).toContain("SOUL.md size");
  });

  it("gates fix text past the free limit for unlicensed users", () => {
    const many: AuditResult[] = Array.from({ length: 6 }, (_, i) => ({
      category: "C", check: `check${i}`, status: "fail", message: "m", fix: `fix-${i}`,
    }));
    generateReport(report(many), { licensed: false });
    expect(out).toContain("fix-0");
    expect(out).toContain("fix-2");
    expect(out).toContain("fix hidden"); // beyond the free limit
  });
});

describe("printScanResults", () => {
  let out: string;
  beforeEach(() => {
    out = "";
    vi.spyOn(console, "log").mockImplementation((...args) => {
      out += args.join(" ") + "\n";
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("reports a clean scan with a check symbol", () => {
    printScanResults([]);
    expect(out).toContain("✓");
    expect(out).toContain("No suspicious patterns");
  });

  it("renders findings with status symbols", () => {
    printScanResults([
      { category: "Skills", check: "x", status: "fail", message: "Unicode-encoded sequence" },
    ]);
    expect(out).toContain("✗");
    expect(out).toContain("Unicode-encoded sequence");
  });
});
