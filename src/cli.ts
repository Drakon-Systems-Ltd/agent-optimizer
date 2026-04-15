#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { runFullAudit } from "./auditors/index.js";
import { generateReport, printBanner, printScanResults } from "./reporters/index.js";
import {
  loadLicense,
  saveLicense,
  removeLicense,
  getLicensePath,
  validateLicense,
  canUseFleet,
  PRICING,
} from "./licensing/index.js";
import type { License, LicenseData } from "./licensing/index.js";

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const program = new Command();

program
  .name("agent-optimizer")
  .description(
    "OpenClaw Agent Optimizer by Drakon Systems — audit, optimize, and secure your OpenClaw deployment"
  )
  .version(version)
  .addHelpText("before", () => {
    const r = chalk.red;
    const w = chalk.bold.white;
    const d = chalk.dim;

    return [
      "",
      r("  🦞 ") + w("AGENT OPTIMIZER") + d(` v${version}`),
      d("  ─────────────────────────────"),
      "",
      d("  FREE"),
      `    ${w("audit")}  ${d("[-c config] [--json] [--deep]")}     ${d("Full 70+ check audit")}`,
      `    ${w("scan")}   ${d("[-c config] [--workspace path]")}    ${d("Malware + billing scan")}`,
      `    ${w("optimize --dry-run")} ${d("[--profile name]")}      ${d("Preview optimizations")}`,
      `    ${w("drift")}  ${d("[--name snapshot]")}                 ${d("Config drift detection")}`,
      `    ${w("snapshot save")} ${d("[--name golden]")}            ${d("Save config baseline")}`,
      "",
      d("  LICENSED") + d(" (Solo £29+)"),
      `    ${w("audit --fix")}                              ${d("Auto-apply safe fixes")}`,
      `    ${w("optimize")} ${d("[--profile] [--only] [--skip]")}   ${d("Apply optimizations")}`,
      `    ${w("rollback")}                                 ${d("Restore pre-optimize backup")}`,
      "",
      d("  FLEET") + d(" (£79+)"),
      `    ${w("fleet")} ${d("--hosts a,b,c [--json]")}             ${d("SSH fleet audit")}`,
      "",
      d("  UTILITY"),
      `    ${w("activate")} ${d("<key>")}       ${w("license")}          ${w("update")}`,
      `    ${w("deactivate")}          ${w("snapshot list")}     ${w("drift")}`,
      "",
      d("  Use") + ` ${w("agent-optimizer <command> --help")} ` + d("for full options"),
      "",
    ].join("\n");
  })
  .helpOption("-h, --help", "Display this help screen");

// Suppress default help text for the root program only (subcommands keep theirs)
const originalHelpInfo = program.helpInformation.bind(program);
program.helpInformation = function () {
  return ""; // our beforeAll text replaces this
};

// --- License helpers ---

function hasValidLicense(): License | null {
  const license = loadLicense();
  if (!license) return null;
  const check = validateLicense(license);
  return check.valid ? license : null;
}

function printUpgradePrompt(feature: string): void {
  console.log(
    chalk.red(`\n  ░░ ${feature} requires a license.\n`)
  );
  console.log(chalk.dim("  ┌─────────────────────────────────────────────┐"));
  for (const tier of PRICING) {
    const price = `£${(tier.price / 100).toFixed(0)}`;
    console.log(
      chalk.dim("  │ ") +
      chalk.bold.white(tier.name.padEnd(12)) +
      chalk.red(price.padStart(5)) +
      chalk.dim("  " + tier.description.padEnd(26)) +
      chalk.dim("│")
    );
  }
  console.log(chalk.dim("  └─────────────────────────────────────────────┘"));
  console.log(
    chalk.dim("\n  → ") + chalk.white("https://drakonsystems.com/products/agent-optimizer/buy")
  );
  console.log(
    chalk.dim("  → ") + chalk.dim("agent-optimizer activate <key>\n")
  );
}

function requireLicense(command: string): License {
  const license = hasValidLicense();
  if (!license) {
    printUpgradePrompt(
      command === "fleet" ? "Fleet audit" :
      command === "optimize" ? "Auto-fix" :
      "This feature"
    );
    process.exit(1);
  }

  if (command === "fleet" && !canUseFleet(license.data.tier)) {
    console.log(
      chalk.red("\n✗ Fleet audit requires a Fleet or Lifetime license.\n")
    );
    console.log("Upgrade at: https://drakonsystems.com/products/agent-optimizer/buy?tier=fleet");
    console.log(
      chalk.dim(`Current license: ${license.data.tier} (${license.data.email})`)
    );
    process.exit(1);
  }

  return license;
}

// --- License management commands ---

program
  .command("activate <key>")
  .description("Activate a license key")
  .option("--email <email>", "Email used for purchase")
  .action(async (key: string, opts: { email?: string }) => {
    printBanner();
    console.log(chalk.dim("  mode: ") + chalk.white("license activation\n"));

    if (!/^AO-[A-Z]{3,4}-[A-F0-9]{8}-[A-F0-9]{8}$/.test(key)) {
      console.log(chalk.red("Invalid key format."));
      console.log(chalk.dim("Expected: AO-XXXX-XXXXXXXX-XXXXXXXX"));
      process.exit(1);
    }

    try {
      const response = await fetch(
        "https://drakonsystems.com/api/agent-optimizer/activate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, email: opts.email }),
        }
      );

      if (!response.ok) {
        const body = await response.text();
        console.log(chalk.red(`Activation failed: ${body}`));
        process.exit(1);
      }

      const license = (await response.json()) as License;
      saveLicense(license);
      console.log(chalk.green("✓ License activated successfully\n"));
      console.log(`  Tier:    ${license.data.tier}`);
      console.log(`  Email:   ${license.data.email}`);
      console.log(
        `  Expires: ${license.data.expiresAt ?? "Never (lifetime)"}`
      );
      console.log(chalk.dim(`\n  Saved to: ${getLicensePath()}`));
    } catch (e) {
      console.log(
        chalk.red(`Could not reach licensing server: ${(e as Error).message}`)
      );
      console.log(
        chalk.dim(
          "If you purchased offline, contact support@drakonsystems.com"
        )
      );
      process.exit(1);
    }
  });

program
  .command("license")
  .description("Show current license status")
  .action(() => {
    printBanner();
    console.log(chalk.dim("  mode: ") + chalk.white("license status\n"));

    const license = loadLicense();
    if (!license) {
      console.log(chalk.red("  ░░") + " No license installed\n");
      console.log(chalk.dim("  Free commands work without a license:"));
      console.log(`  ${chalk.red("→")} ${chalk.white("agent-optimizer audit")}`);
      console.log(`  ${chalk.red("→")} ${chalk.white("agent-optimizer scan")}`);
      console.log(`  ${chalk.red("→")} ${chalk.white("agent-optimizer optimize --dry-run")}\n`);
      console.log(chalk.dim("  → ") + chalk.white("https://drakonsystems.com/products/agent-optimizer/buy\n"));
      return;
    }

    const check = validateLicense(license);
    console.log(chalk.dim("  ┌─────────────────────────────────────────────┐"));
    console.log(chalk.dim("  │ ") + chalk.dim("Key     ") + chalk.white(license.key.padEnd(37)) + chalk.dim("│"));
    console.log(chalk.dim("  │ ") + chalk.dim("Tier    ") + chalk.bold.white(license.data.tier.padEnd(37)) + chalk.dim("│"));
    console.log(chalk.dim("  │ ") + chalk.dim("Email   ") + chalk.white(license.data.email.padEnd(37)) + chalk.dim("│"));
    console.log(chalk.dim("  │ ") + chalk.dim("Expires ") + chalk.white((license.data.expiresAt ?? "Never (lifetime)").padEnd(37)) + chalk.dim("│"));
    console.log(chalk.dim("  │ ") + chalk.dim("Status  ") + (check.valid ? chalk.green("Valid".padEnd(37)) : chalk.red((check.reason ?? "Invalid").padEnd(37))) + chalk.dim("│"));
    console.log(chalk.dim("  │ ") + chalk.dim("Fleet   ") + (canUseFleet(license.data.tier) ? chalk.green("Yes".padEnd(37)) : chalk.dim("No (upgrade to Fleet)".padEnd(37))) + chalk.dim("│"));
    console.log(chalk.dim("  └─────────────────────────────────────────────┘\n"));
  });

program
  .command("deactivate")
  .description("Remove the current license from this machine")
  .action(() => {
    if (removeLicense()) {
      console.log(chalk.green("\n✓ License removed.\n"));
    } else {
      console.log(chalk.yellow("\nNo license to remove.\n"));
    }
  });

program
  .command("update")
  .description("Check for updates and install the latest version")
  .action(async () => {
    printBanner();
    console.log(chalk.dim("  mode: ") + chalk.white("update\n"));
    console.log(`  Current: v${version}\n`);
    console.log("  Checking for updates...");

    const { execSync } = await import("child_process");
    try {
      const latest = execSync("npm view @drakon-systems/agent-optimizer version", {
        encoding: "utf-8",
        timeout: 15000,
      }).trim();

      if (latest === version) {
        console.log(chalk.green(`  ✓ Already on latest (v${version})\n`));
        return;
      }

      console.log(`  New version available: ${chalk.white(`v${latest}`)} (current: v${version})\n`);
      console.log("  Installing...");
      execSync("npm install -g @drakon-systems/agent-optimizer@latest", {
        stdio: "pipe",
        timeout: 60000,
      });
      console.log(chalk.green(`\n  ✓ Updated to v${latest}\n`));
    } catch (e) {
      console.log(chalk.red(`\n  ✗ Update failed: ${(e as Error).message.split("\n")[0]}`));
      console.log(chalk.dim("  Try manually: npm install -g @drakon-systems/agent-optimizer@latest\n"));
    }
  });

// --- Free commands (audit + scan show results, fixes are gated) ---

program
  .command("audit")
  .description("Run a full audit of your OpenClaw installation (free)")
  .option(
    "-c, --config <path>",
    "Path to openclaw.json",
    "~/.openclaw/openclaw.json"
  )
  .option("-a, --agent-dir <path>", "Path to agent directory")
  .option("--json", "Output results as JSON")
  .option("--fix", "Apply safe fixes automatically (requires license)")
  .option("--deep", "Include live gateway probes")
  .action(async (opts) => {
    if (opts.fix) {
      const license = hasValidLicense();
      if (!license) {
        // Run audit first to show them what they're missing, THEN gate the fix
        printBanner();
        const results = await runFullAudit(opts);
        generateReport(results, { ...opts, fix: false });

        const fixable = results.results.filter((r) => r.autoFixable);
        if (fixable.length > 0) {
          console.log(
            chalk.yellow(
              `\n🔒 ${fixable.length} issue(s) can be auto-fixed — but --fix requires a license.\n`
            )
          );
        } else {
          console.log(
            chalk.yellow("\n🔒 --fix requires a license to apply changes.\n")
          );
        }
        printUpgradePrompt("Auto-fix");
        process.exit(1);
      }
    }

    printBanner();
    const results = await runFullAudit(opts);
    generateReport(results, opts);

    // If no license, show the upsell after results
    if (!hasValidLicense()) {
      const warns = results.summary.warn;
      const fails = results.summary.fail;
      if (warns > 0 || fails > 0) {
        console.log(
          chalk.dim("  ┌─────────────────────────────────────────────┐")
        );
        console.log(
          chalk.dim("  │ ") + chalk.red("→ ") + chalk.white("agent-optimizer optimize") + chalk.dim("       preview fixes │")
        );
        console.log(
          chalk.dim("  │ ") + chalk.red("→ ") + chalk.white("agent-optimizer audit --fix") + chalk.dim("    auto-apply  │")
        );
        console.log(
          chalk.dim("  └─────────────────────────────────────────────┘\n")
        );
      }
    }
  });

program
  .command("scan")
  .description(
    "Scan installed skills and plugins for billing, malware, or suspicious patterns (free)"
  )
  .option(
    "-c, --config <path>",
    "Path to openclaw.json",
    "~/.openclaw/openclaw.json"
  )
  .option("--workspace <path>", "Path to workspace directory")
  .action(async (opts) => {
    printBanner();
    console.log(chalk.dim("  mode: ") + chalk.white("security scan\n"));
    const { runSecurityScan } = await import("./auditors/security-scan.js");
    const results = await runSecurityScan(opts);

    printScanResults(results);

    if (!hasValidLicense() && results.length > 0) {
      const suspicious = results.filter((r) => r.status === "warn" || r.status === "fail");
      if (suspicious.length > 0) {
        console.log(chalk.dim("  ┌─────────────────────────────────────────────┐"));
        console.log(chalk.dim("  │ ") + chalk.red(`${suspicious.length} suspicious pattern(s) found`) + chalk.dim("               │"));
        console.log(chalk.dim("  │ ") + chalk.dim("Fleet scanning: drakonsystems.com/products/") + chalk.dim("  │"));
        console.log(chalk.dim("  │ ") + chalk.dim("agent-optimizer/buy") + chalk.dim("                        │"));
        console.log(chalk.dim("  └─────────────────────────────────────────────┘\n"));
      }
    }
  });

// --- Paid commands ---

program
  .command("optimize")
  .description("Preview or apply recommended optimizations")
  .option(
    "-c, --config <path>",
    "Path to openclaw.json",
    "~/.openclaw/openclaw.json"
  )
  .option("--dry-run", "Preview changes without applying")
  .option(
    "--profile <name>",
    "Optimization profile: minimal | balanced | aggressive",
    "balanced"
  )
  .option(
    "--only <tags>",
    "Only apply these optimizations (comma-separated: context,heartbeat,subagents,compaction,pruning)"
  )
  .option(
    "--skip <tags>",
    "Skip these optimizations (comma-separated: context,heartbeat,subagents,compaction,pruning)"
  )
  .action(async (opts) => {
    const licensed = hasValidLicense();
    const effectiveDryRun = opts.dryRun || !licensed;

    // Parse comma-separated tags
    const only = opts.only ? opts.only.split(",").map((t: string) => t.trim()) : undefined;
    const skip = opts.skip ? opts.skip.split(",").map((t: string) => t.trim()) : undefined;

    printBanner();
    console.log(chalk.dim("  mode: ") + chalk.white("optimize") + chalk.dim(` · ${effectiveDryRun ? "dry-run" : "apply"} · ${opts.profile}\n`));
    const { runOptimize } = await import("./optimizers/index.js");
    await runOptimize({ ...opts, dryRun: effectiveDryRun, only, skip });

    if (!licensed) {
      console.log(
        chalk.yellow(
          "\n🔒 To apply these changes, activate a license:\n"
        )
      );
      console.log(
        `   ${chalk.dim("agent-optimizer activate <key>")}`
      );
      console.log(
        chalk.dim(
          "   https://drakonsystems.com/products/agent-optimizer/buy\n"
        )
      );
    }
  });

program
  .command("rollback")
  .description("Restore config from the last pre-optimize backup")
  .option(
    "-c, --config <path>",
    "Path to openclaw.json",
    "~/.openclaw/openclaw.json"
  )
  .action(async (opts) => {
    const { existsSync, copyFileSync, readFileSync } = await import("fs");
    const { expandPath } = await import("./utils/config.js");

    const configPath = expandPath(opts.config);
    const backupPath = `${configPath}.pre-optimize.bak`;

    printBanner();
    console.log(chalk.dim("  mode: ") + chalk.white("rollback\n"));

    if (!existsSync(backupPath)) {
      console.log(chalk.yellow("  No backup found."));
      console.log(chalk.dim(`  Expected: ${backupPath}`));
      console.log(chalk.dim("  Backups are created automatically when you run: agent-optimizer optimize\n"));
      process.exit(1);
    }

    // Show what's different
    try {
      const current = JSON.parse(readFileSync(configPath, "utf-8"));
      const backup = JSON.parse(readFileSync(backupPath, "utf-8"));

      const currentCtx = current.agents?.defaults?.contextTokens;
      const backupCtx = backup.agents?.defaults?.contextTokens;
      const currentHb = current.agents?.defaults?.heartbeat?.every;
      const backupHb = backup.agents?.defaults?.heartbeat?.every;

      if (currentCtx !== backupCtx || currentHb !== backupHb) {
        console.log("  Changes that will be reverted:");
        if (currentCtx !== backupCtx) {
          console.log(`    contextTokens: ${currentCtx} → ${backupCtx}`);
        }
        if (currentHb !== backupHb) {
          console.log(`    heartbeat: ${currentHb} → ${backupHb}`);
        }
        console.log();
      }
    } catch {
      // Can't diff — just restore
    }

    // Restore
    copyFileSync(backupPath, configPath);
    console.log(chalk.green("  ✓ Config restored from backup"));
    console.log(chalk.dim(`  Restored: ${configPath}`));
    console.log(chalk.dim(`  From:     ${backupPath}\n`));
    console.log(chalk.dim("  Restart the gateway to apply: systemctl --user restart openclaw-gateway\n"));
  });

// --- Snapshot & drift ---

const snapshot = program
  .command("snapshot")
  .description("Save or list config snapshots for drift detection");

snapshot
  .command("save")
  .description("Save the current config as a named snapshot")
  .option(
    "-c, --config <path>",
    "Path to openclaw.json",
    "~/.openclaw/openclaw.json"
  )
  .option("--name <name>", "Snapshot name", "golden")
  .action(async (opts) => {
    printBanner();
    console.log(chalk.dim("  mode: ") + chalk.white("snapshot save\n"));
    const { saveSnapshot } = await import("./auditors/config-drift.js");
    saveSnapshot(opts.config, opts.name);
  });

snapshot
  .command("list")
  .description("List saved snapshots")
  .action(async () => {
    const { listSnapshots } = await import("./auditors/config-drift.js");
    listSnapshots();
  });

program
  .command("drift")
  .description("Compare current config against a saved snapshot")
  .option(
    "-c, --config <path>",
    "Path to openclaw.json",
    "~/.openclaw/openclaw.json"
  )
  .option("--name <name>", "Snapshot name to compare against", "golden")
  .action(async (opts) => {
    printBanner();
    console.log(chalk.dim("  mode: ") + chalk.white("drift detection\n"));
    const { detectDrift } = await import("./auditors/config-drift.js");
    const results = detectDrift(opts.config, opts.name);
    generateReport(
      {
        timestamp: new Date().toISOString(),
        host: "localhost",
        openclawVersion: "unknown",
        results,
        summary: {
          total: results.length,
          pass: results.filter((r) => r.status === "pass").length,
          warn: results.filter((r) => r.status === "warn").length,
          fail: results.filter((r) => r.status === "fail").length,
        },
      },
      { json: opts.json }
    );
  });

program
  .command("fleet")
  .description("Audit multiple OpenClaw instances via SSH (requires Fleet/Lifetime license)")
  .option("--hosts <hosts>", "Comma-separated list of SSH hosts")
  .option("--ssh-config <path>", "Path to SSH config file", "~/.ssh/config")
  .option("--json", "Output results as JSON")
  .action(async (opts) => {
    requireLicense("fleet");
    printBanner();
    console.log(chalk.dim("  mode: ") + chalk.white("fleet audit\n"));
    const { runFleetAudit } = await import("./auditors/fleet.js");
    await runFleetAudit(opts);
  });

program.parse();
