import chalk from "chalk";
import { createRequire } from "module";
import type { AuditReport, AuditResult } from "../types.js";

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
const grey = chalk.grey;

// Status blocks — visual weight instead of tiny icons
const STATUS_BLOCK: Record<string, string> = {
  pass: green("██"),
  warn: yellow("▓▓"),
  fail: red("░░"),
  info: blue("▪▪"),
};

const STATUS_DOT: Record<string, string> = {
  pass: green("●"),
  warn: yellow("●"),
  fail: red("●"),
  info: blue("●"),
};

// ── Health score ────────────────────────────────────────────────────
function calculateHealthScore(report: AuditReport): number {
  const { pass, warn, fail, total } = report.summary;
  if (total === 0) return 100;
  // pass = full points, info = full, warn = 0.4, fail = 0
  const info = total - pass - warn - fail;
  const score = ((pass + info) * 1.0 + warn * 0.4 + fail * 0) / total;
  return Math.round(score * 100);
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
function printBanner(): void {
  console.log();
  console.log(red("  🦞 ") + white("AGENT OPTIMIZER") + dim(` v${version}`));
  console.log(dim("  ─────────────────────────────"));
}

// ── Main report ─────────────────────────────────────────────────────
export function generateReport(
  report: AuditReport,
  opts: { json?: boolean }
): void {
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Group by category
  const categories = new Map<string, AuditResult[]>();
  for (const result of report.results) {
    if (!categories.has(result.category)) {
      categories.set(result.category, []);
    }
    categories.get(result.category)!.push(result);
  }

  // Print each category
  for (const [category, results] of categories) {
    // Category header with line
    const label = `  ${redBold("▸")} ${white(category)} `;
    const lineLen = Math.max(0, 48 - category.length);
    console.log(`\n${label}${dim("─".repeat(lineLen))}`);

    for (const r of results) {
      const block = STATUS_BLOCK[r.status] ?? "??";
      // Truncate long messages for compact display
      const msg = r.message.length > 80 ? r.message.slice(0, 78) + "…" : r.message;
      console.log(`  ${block} ${dim(r.check + ":")} ${statusColour(r.status, msg)}`);
      if (r.fix && (r.status === "fail" || r.status === "warn")) {
        console.log(`     ${red("→")} ${dim(r.fix)}`);
      }
    }
  }

  // ── Summary bar ──────────────────────────────────────────────────
  const score = calculateHealthScore(report);

  console.log(`\n  ${dim("━".repeat(48))}`);
  console.log(`  ${dim("HEALTH")}  ${renderHealthBar(score)} ${scoreColour(score)(`${score}/100`)}`);
  console.log(`  ${dim("━".repeat(48))}`);

  const { pass, warn, fail, total } = report.summary;
  const info = total - pass - warn - fail;

  const parts: string[] = [];
  if (pass > 0) parts.push(`${green("██")} ${pass} pass`);
  if (warn > 0) parts.push(`${yellow("▓▓")} ${warn} warn`);
  if (fail > 0) parts.push(`${red("░░")} ${fail} fail`);
  if (info > 0) parts.push(`${blue("▪▪")} ${info} info`);

  console.log(`  ${parts.join("   ")}`);

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

// ── Scan reporter (for security-scan.ts) ────────────────────────────
export function printScanResults(results: AuditResult[]): void {
  if (results.length === 0) {
    console.log(green("  ██ No suspicious patterns found\n"));
    return;
  }

  const categories = new Map<string, AuditResult[]>();
  for (const r of results) {
    if (!categories.has(r.category)) categories.set(r.category, []);
    categories.get(r.category)!.push(r);
  }

  for (const [category, catResults] of categories) {
    const label = `  ${redBold("▸")} ${white(category)} `;
    const lineLen = Math.max(0, 48 - category.length);
    console.log(`\n${label}${dim("─".repeat(lineLen))}`);

    for (const r of catResults) {
      const block = STATUS_BLOCK[r.status] ?? "??";
      console.log(`  ${block} ${statusColour(r.status, r.message)}`);
    }
  }
  console.log();
}

// ── Progress helpers for audit pipeline ─────────────────────────────
export { printBanner };
