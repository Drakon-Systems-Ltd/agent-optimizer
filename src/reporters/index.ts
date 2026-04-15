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

// Status blocks — visual weight instead of tiny icons
const STATUS_BLOCK: Record<string, string> = {
  pass: green("██"),
  warn: yellow("▓▓"),
  fail: red("░░"),
  info: blue("▪▪"),
};

// How many fix instructions to show for free
const FREE_FIX_LIMIT = 3;

// ── Health score ────────────────────────────────────────────────────
function calculateHealthScore(report: AuditReport): number {
  const { pass, warn, fail, total } = report.summary;
  if (total === 0) return 100;
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

// ── Main report ─────────────────────────────────────────────────────
export function generateReport(
  report: AuditReport,
  opts: { json?: boolean; licensed?: boolean }
): void {
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const licensed = opts.licensed ?? false;

  // Group by category
  const categories = new Map<string, AuditResult[]>();
  for (const result of report.results) {
    if (!categories.has(result.category)) {
      categories.set(result.category, []);
    }
    categories.get(result.category)!.push(result);
  }

  // Track fix display for gating
  let fixesShown = 0;
  let fixesGated = 0;

  // Print each category
  for (const [category, results] of categories) {
    const label = `  ${redBold("▸")} ${white(category)} `;
    const lineLen = Math.max(0, 48 - category.length);
    console.log(`\n${label}${dim("─".repeat(lineLen))}`);

    for (const r of results) {
      const block = STATUS_BLOCK[r.status] ?? "??";
      const msg = r.message.length > 80 ? r.message.slice(0, 78) + "…" : r.message;
      console.log(`  ${block} ${dim(r.check + ":")} ${statusColour(r.status, msg)}`);

      // Fix instruction gating
      if (r.fix && (r.status === "fail" || r.status === "warn")) {
        if (licensed || fixesShown < FREE_FIX_LIMIT) {
          console.log(`     ${red("→")} ${dim(r.fix)}`);
          fixesShown++;
        } else {
          console.log(`     ${red("→")} ${dim("██████████████████████████████")}`);
          fixesGated++;
        }
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

  // ── ROI upsell for unlicensed users ──────────────────────────────
  if (!licensed && fixesGated > 0) {
    const monthly = extractMonthlySavings(report);
    const annual = monthly ? monthly * 12 : null;

    console.log();
    console.log(dim("  ┌─────────────────────────────────────────────┐"));

    if (annual && annual > 29) {
      const payback = Math.ceil(29 / monthly!);
      console.log(dim("  │ ") + red(`£${annual}/year`) + dim(" in token waste identified") + dim("           │"));
      console.log(dim("  │ ") + white(`£29 license pays for itself in ${payback} day${payback > 1 ? "s" : ""}`) + dim("        │"));
    }

    console.log(dim("  │ ") + yellow(`${fixesGated} fix instruction${fixesGated > 1 ? "s" : ""} hidden`) + dim(" — unlock with a license") + dim("   │"));
    console.log(dim("  │                                             │"));
    console.log(dim("  │ ") + red("→ ") + white("agent-optimizer buy") + dim("        open purchase page │"));
    console.log(dim("  │ ") + red("→ ") + white("agent-optimizer activate <key>") + dim(" activate      │"));
    console.log(dim("  └─────────────────────────────────────────────┘"));
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

export { printBanner };
