import chalk from "chalk";
import { createRequire } from "module";
import type { AuditReport, AuditResult } from "../types.js";
import { loadMonitorState } from "../monitor/state.js";
import { termWidth, wrap } from "../utils/format.js";
import { stampFindingIds } from "../utils/finding-id.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json");

// ── Colour palette ──────────────────────────────────────────────────
const red = chalk.red;
const redBold = chalk.bold.red;
const green = chalk.green;
const yellow = chalk.yellow;
const blue = chalk.blue;
const dim = chalk.dim;
const white = chalk.bold.white;

// Status marks — shape-distinct so they read without colour (colourblind-safe).
const STATUS_SYMBOL: Record<string, string> = {
  pass: green("✓"),
  warn: yellow("⚠"),
  fail: red("✗"),
  info: blue("i"),
};


// ── Health score ────────────────────────────────────────────────────
export function calculateHealthScore(report: AuditReport): number {
  // info rows are neutral notes — scoring them as passes inflated the number
  // (an agent with dead primary auth scored 89/100).
  const { pass, warn, fail } = report.summary;
  const scored = pass + warn + fail;
  if (scored === 0) return 100;
  return Math.round(((pass + warn * 0.4) / scored) * 100);
}

function renderHealthBar(score: number, width: number = 20): string {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;

  let colour: (s: string) => string;
  if (score >= 80) colour = green;
  else if (score >= 60) colour = yellow;
  else colour = red;

  return colour("█".repeat(filled)) + dim("░".repeat(empty));
}

// ── Banner ──────────────────────────────────────────────────────────
// In JSON mode the banner goes to stderr so stdout stays machine-parseable
// (`audit --json | jq` must work).
function printBanner(toStderr = false): void {
  const log = toStderr ? console.error : console.log;
  log();
  log(red("  🦞 ") + white("AGENT OPTIMIZER") + dim(` v${version}`));
  log(dim("  ─────────────────────────────"));
}

// ── ROI calculation ─────────────────────────────────────────────────
function extractMonthlySavings(report: AuditReport): number | null {
  // Look for the savings result from cost estimator
  const savingsResult = report.results.find(
    (r) => r.category === "Cost Estimate" && r.check.includes("savings")
  );
  if (!savingsResult) return null;

  // Extract £ amount from message like "Save ~£47/month"
  const match = savingsResult.message.match(/£(\d+)/);
  return match ? parseInt(match[1]) : null;
}

// ── Display dedup ───────────────────────────────────────────────────
// Different auditors legitimately re-derive the same fact (an expired token
// surfaces in Auth AND per-rung in Provider Failover). The JSON output keeps
// every row; the human report shows each distinct message once.
type DisplayResult = AuditResult & { dupCount?: number };

export function dedupeForDisplay(results: AuditResult[]): DisplayResult[] {
  const seen = new Map<string, DisplayResult>();
  const out: DisplayResult[] = [];
  for (const r of results) {
    const key = `${r.status}|${r.message}`;
    const prev = seen.get(key);
    if (prev) {
      prev.dupCount = (prev.dupCount ?? 0) + 1;
      continue;
    }
    const copy: DisplayResult = { ...r };
    seen.set(key, copy);
    out.push(copy);
  }
  return out;
}

// ── Main report ─────────────────────────────────────────────────────
export function generateReport(
  report: AuditReport,
  opts: { json?: boolean; licensed?: boolean; verbose?: boolean }
): void {
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const licensed = opts.licensed ?? false;
  const width = termWidth();
  const rule = "─".repeat(Math.min(48, width - 2));

  const deduped = dedupeForDisplay(report.results);
  const fails = deduped.filter((r) => r.status === "fail");
  const warns = deduped.filter((r) => r.status === "warn");
  const infos = deduped.filter((r) => r.status === "info");
  const passes = deduped.filter((r) => r.status === "pass");

  // Render one fail/warn finding: header line, wrapped message, fix advice.
  // Advice is always shown — the licensed feature is --fix APPLYING it.
  const renderFinding = (r: DisplayResult, colour: (s: string) => string): void => {
    const sym = STATUS_SYMBOL[r.status] ?? "?";
    console.log(`  ${sym} ${white(r.category)} ${dim("·")} ${dim(r.check)}`);
    for (const line of wrap(r.message, width - 4)) console.log("    " + colour(line));
    if (r.fix && (r.status === "fail" || r.status === "warn")) {
      const fixLines = wrap(r.fix, width - 6);
      const autoTag = r.machineFixable ? dim("  (auto-fixable)") : "";
      console.log("    " + red("→ " + fixLines[0]) + (fixLines.length === 1 ? autoTag : ""));
      for (let i = 1; i < fixLines.length; i++) {
        console.log("      " + red(fixLines[i]) + (i === fixLines.length - 1 ? autoTag : ""));
      }
    }
    if (r.dupCount) {
      console.log("    " + dim(`also flagged by ${r.dupCount} other check${r.dupCount > 1 ? "s" : ""}`));
    }
  };

  // ── Health bar ───────────────────────────────────────────────────
  const score = calculateHealthScore(report);
  const { pass, warn, fail, total } = report.summary;
  const info = total - pass - warn - fail;

  console.log(`\n  ${dim("Health")}  ${renderHealthBar(score)}  ${scoreColour(score)(`${score}/100`)}`);

  const parts: string[] = [];
  if (fail > 0) parts.push(`${red("✗")} ${fail} fail`);
  if (warn > 0) parts.push(`${yellow("⚠")} ${warn} warn`);
  if (info > 0) parts.push(`${blue("i")} ${info} info`);
  if (pass > 0) parts.push(`${green("✓")} ${pass} pass`);
  if (parts.length > 0) console.log(`  ${parts.join("   ")}`);

  // ── Needs attention: fails first, then warns ─────────────────────
  if (fails.length > 0 || warns.length > 0) {
    console.log(`\n  ${redBold("NEEDS ATTENTION")} ${dim(rule.slice(16))}`);
    for (const r of fails) renderFinding(r, red);
    for (const r of warns) renderFinding(r, yellow);
  }

  // ── Notes (info) — compact, one wrapped entry each ───────────────
  // Default view keeps Cost Estimate notes (the numbers people care about)
  // and collapses the rest to a count; --verbose shows everything.
  if (infos.length > 0) {
    const shown = opts.verbose
      ? infos
      : infos.filter((r) => r.category === "Cost Estimate");
    const hidden = infos.length - shown.length;
    if (shown.length > 0) {
      console.log(`\n  ${blue("NOTES")} ${dim(rule.slice(6))}`);
      for (const r of shown) {
        const lines = wrap(`${r.category} · ${r.message}`, width - 4);
        console.log(`  ${blue("i")} ${dim(lines[0])}`);
        for (const line of lines.slice(1)) console.log("    " + dim(line));
        if (r.dupCount) console.log("    " + dim(`also flagged by ${r.dupCount} other check${r.dupCount > 1 ? "s" : ""}`));
      }
    }
    if (hidden > 0) {
      console.log(`\n  ${blue("i")} ${dim(`${hidden} informational note${hidden > 1 ? "s" : ""} hidden — rerun with --verbose to see them`)}`);
    }
  }

  // ── Passed — condensed single list of check names ────────────────
  if (passes.length > 0) {
    console.log(`\n  ${green("✓")} ${dim(`${passes.length} passed:`)}`);
    const names = passes.map((r) => r.check).join("  ·  ");
    for (const line of wrap(names, width - 4)) console.log("    " + dim(line));
  }

  console.log(`\n  ${dim(rule)}`);

  // Version info
  if (report.openclawVersion && report.openclawVersion !== "unknown") {
    console.log(`\n  ${dim("OpenClaw")} ${white(report.openclawVersion)}  ${dim("·")}  ${dim(report.timestamp.split("T")[0])}`);
  } else {
    console.log(`\n  ${dim(report.timestamp.split("T")[0])}`);
  }

  // Status message
  if (fail > 0) {
    console.log(red(`\n  ✗ ${fail} critical issue${fail > 1 ? "s" : ""} — fix before deploying`));
  } else if (warn > 0) {
    console.log(yellow(`\n  ⚠ ${warn} warning${warn > 1 ? "s" : ""} — review recommended`));
  } else {
    console.log(green(`\n  ✓ All checks passed — clean config`));
  }

  // ── ROI upsell for unlicensed users ──────────────────────────────
  // Every fix instruction above is free; the licensed feature is --fix
  // applying the machine-fixable ones for you.
  const autoFixable = deduped.filter(
    (r) => (r.status === "fail" || r.status === "warn") && r.machineFixable
  ).length;
  if (!licensed && autoFixable > 0) {
    const monthly = extractMonthlySavings(report);
    const annual = monthly ? monthly * 12 : null;

    console.log();
    console.log(dim("  ┌─────────────────────────────────────────────┐"));

    if (annual && annual > 29) {
      const payback = Math.ceil(29 / monthly!);
      console.log(dim("  │ ") + red(`£${annual}/year`) + dim(" in token waste identified") + dim("           │"));
      console.log(dim("  │ ") + white(`£29 license pays for itself in ${payback} day${payback > 1 ? "s" : ""}`) + dim("        │"));
    }

    console.log(dim("  │ ") + yellow(`${autoFixable} finding${autoFixable > 1 ? "s" : ""} auto-fixable`) + dim(" — `audit --fix` applies") + dim("  │"));
    console.log(dim("  │ ") + dim("them for you (licensed)") + dim("                     │"));
    console.log(dim("  │ ") + red("→ ") + white("agent-optimizer buy") + dim("        open purchase page │"));
    console.log(dim("  │ ") + red("→ ") + white("agent-optimizer activate <key>") + dim(" activate      │"));
    console.log(dim("  └─────────────────────────────────────────────┘"));
  }

  // ── Monitor nudge for unenrolled users ───────────────────────────
  // Only show when audit found issues — otherwise the nudge is noise.
  const monitorState = loadMonitorState();
  if (!monitorState && (warn > 0 || fail > 0)) {
    console.log();
    console.log(
      dim("  💡 Track your health score over time and get weekly email reports:")
    );
    console.log(
      dim("     ") + white("agent-optimizer monitor enroll <your@email>") + dim("  (free)")
    );
  }

  console.log();
}

// ── Helpers ──────────────────────────────────────────────────────────
function statusColour(status: string, text: string): string {
  switch (status) {
    case "pass": return text;
    case "warn": return yellow(text);
    case "fail": return red(text);
    case "info": return dim(text);
    default: return text;
  }
}

function scoreColour(score: number): (s: string) => string {
  if (score >= 80) return green;
  if (score >= 60) return yellow;
  return red;
}

// ── Scan reporter ───────────────────────────────────────────────────
export function printScanResults(results: AuditResult[]): void {
  if (results.length === 0) {
    console.log(`  ${green("✓")} ${green("No suspicious patterns found")}\n`);
    return;
  }

  const width = termWidth();
  const categories = new Map<string, AuditResult[]>();
  for (const r of results) {
    if (!categories.has(r.category)) categories.set(r.category, []);
    categories.get(r.category)!.push(r);
  }

  for (const [category, catResults] of categories) {
    const lineLen = Math.max(0, Math.min(48, width - 2) - category.length - 4);
    console.log(`\n  ${redBold("▸")} ${white(category)} ${dim("─".repeat(lineLen))}`);

    for (const r of catResults) {
      const sym = STATUS_SYMBOL[r.status] ?? "?";
      const lines = wrap(r.message, width - 4);
      console.log(`  ${sym} ${statusColour(r.status, lines[0])}`);
      for (const line of lines.slice(1)) console.log("    " + statusColour(r.status, line));
    }
  }
  console.log();
}

// The machine (`scan --json`) shape: the id-stamped scan findings plus a
// status tally. Mirrors `audit --json`'s schemaVersion:1 contract — every result
// carries a stable `id` + `machineFixable`, and any `untrusted: true` flag set by
// the scanner on third-party content is preserved (stampFindingIds spreads the
// finding through unchanged). summary counts derive from the result statuses.
export interface ScanReport {
  schemaVersion: 1;
  results: Array<AuditResult & { id: string; machineFixable: boolean }>;
  summary: { pass: number; warn: number; fail: number; info: number };
}

export function buildScanReport(results: AuditResult[]): ScanReport {
  const stamped = stampFindingIds(results);
  return {
    schemaVersion: 1,
    results: stamped,
    summary: {
      pass: stamped.filter((r) => r.status === "pass").length,
      warn: stamped.filter((r) => r.status === "warn").length,
      fail: stamped.filter((r) => r.status === "fail").length,
      info: stamped.filter((r) => r.status === "info").length,
    },
  };
}

export { printBanner };
