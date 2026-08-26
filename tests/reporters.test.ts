import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateReport, printScanResults, dedupeForDisplay, calculateHealthScore } from "../src/reporters/index.js";
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

  it("shows ALL fix advice to unlicensed users — the licensed feature is --fix applying it", () => {
    const many: AuditResult[] = Array.from({ length: 6 }, (_, i) => ({
      category: "C", check: `check${i}`, status: "fail", message: `msg-${i}`, fix: `fix-${i}`,
    }));
    generateReport(report(many), { licensed: false });
    for (let i = 0; i < 6; i++) expect(out).toContain(`fix-${i}`);
    expect(out).not.toContain("fix hidden");
  });

  it("dedupes repeated messages across auditors and notes the repeat count", () => {
    const dupes: AuditResult[] = [
      { category: "Auth", check: "token expiry", status: "fail", message: "OAuth token expired 5h ago" },
      { category: "Provider Failover", check: "rung 1", status: "fail", message: "OAuth token expired 5h ago" },
      { category: "Provider Failover", check: "rung 2", status: "fail", message: "OAuth token expired 5h ago" },
    ];
    generateReport(report(dupes), { licensed: true });
    expect(out.split("OAuth token expired 5h ago").length - 1).toBe(1);
    expect(out).toContain("also flagged by 2 other checks");
  });

  it("collapses info notes behind --verbose but keeps Cost Estimate visible", () => {
    const noisy: AuditResult[] = [
      { category: "Cost Estimate", check: "monthly", status: "info", message: "~£94/month estimated" },
      { category: "Plugins", check: "p1", status: "info", message: "plugin note one" },
      { category: "Plugins", check: "p2", status: "info", message: "plugin note two" },
    ];
    generateReport(report(noisy), { licensed: true });
    expect(out).toContain("~£94/month estimated");
    expect(out).not.toContain("plugin note one");
    expect(out).toContain("2 informational notes hidden");

    out = "";
    generateReport(report(noisy), { licensed: true, verbose: true });
    expect(out).toContain("plugin note one");
    expect(out).toContain("plugin note two");
    expect(out).not.toContain("informational notes hidden");
  });
});

describe("dedupeForDisplay", () => {
  it("keeps distinct messages and counts duplicates on the first occurrence", () => {
    const rows: AuditResult[] = [
      { category: "A", check: "c1", status: "warn", message: "same" },
      { category: "B", check: "c2", status: "warn", message: "same" },
      { category: "C", check: "c3", status: "warn", message: "different" },
      { category: "D", check: "c4", status: "info", message: "same" }, // different status — not a dupe
    ];
    const d = dedupeForDisplay(rows);
    expect(d).toHaveLength(3);
    expect(d[0].dupCount).toBe(1);
    expect(d[1].message).toBe("different");
    expect(d[2].status).toBe("info");
  });
});

describe("calculateHealthScore", () => {
  it("ignores info rows instead of scoring them as passes", () => {
    // 1 pass, 1 fail, 20 info: old formula scored this 95/100. Now: 50.
    const rows: AuditResult[] = [
      { category: "A", check: "ok", status: "pass", message: "fine" },
      { category: "A", check: "bad", status: "fail", message: "broken" },
      ...Array.from({ length: 20 }, (_, i) => ({
        category: "N", check: `n${i}`, status: "info" as const, message: `note ${i}`,
      })),
    ];
    expect(calculateHealthScore(report(rows))).toBe(50);
  });

  it("scores warns at 0.4 and an all-pass report at 100", () => {
    const rows: AuditResult[] = [
      { category: "A", check: "ok", status: "pass", message: "fine" },
      { category: "A", check: "meh", status: "warn", message: "iffy" },
    ];
    expect(calculateHealthScore(report(rows))).toBe(70);
    expect(calculateHealthScore(report([rows[0]]))).toBe(100);
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
