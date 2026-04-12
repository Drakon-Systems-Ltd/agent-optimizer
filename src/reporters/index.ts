import chalk from "chalk";
import type { AuditReport } from "../types.js";

const STATUS_ICONS: Record<string, string> = {
  pass: chalk.green("✓"),
  warn: chalk.yellow("⚠"),
  fail: chalk.red("✗"),
  info: chalk.blue("ℹ"),
};

export function generateReport(
  report: AuditReport,
  opts: { json?: boolean }
): void {
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Group by category
  const categories = new Map<string, typeof report.results>();
  for (const result of report.results) {
    if (!categories.has(result.category)) {
      categories.set(result.category, []);
    }
    categories.get(result.category)!.push(result);
  }

  for (const [category, results] of categories) {
    console.log(chalk.bold.underline(`\n${category}`));
    for (const r of results) {
      const icon = STATUS_ICONS[r.status] ?? "?";
      console.log(`  ${icon} ${r.check}: ${r.message}`);
      if (r.fix && (r.status === "fail" || r.status === "warn")) {
        console.log(chalk.dim(`    Fix: ${r.fix}`));
      }
    }
  }

  // Summary
  console.log(chalk.bold("\n─── Summary ───"));
  console.log(
    `  ${chalk.green(`${report.summary.pass} pass`)}  ` +
      `${chalk.yellow(`${report.summary.warn} warn`)}  ` +
      `${chalk.red(`${report.summary.fail} fail`)}  ` +
      `Total: ${report.summary.total}`
  );

  if (report.summary.fail > 0) {
    console.log(chalk.red("\n⚠ Critical issues found — fix before deploying"));
  } else if (report.summary.warn > 0) {
    console.log(chalk.yellow("\n→ Warnings found — review recommended"));
  } else {
    console.log(chalk.green("\n✓ All checks passed"));
  }

  console.log(
    chalk.dim(`\n🔍 Drakon Systems Agent Optimizer v0.1.0 — ${report.timestamp}\n`)
  );
}
