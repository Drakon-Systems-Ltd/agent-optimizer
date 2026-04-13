#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { runFullAudit } from "./auditors/index.js";
import { generateReport } from "./reporters/index.js";
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
  .version(version);

// --- License helpers ---

function hasValidLicense(): License | null {
  const license = loadLicense();
  if (!license) return null;
  const check = validateLicense(license);
  return check.valid ? license : null;
}

function printUpgradePrompt(feature: string): void {
  console.log(
    chalk.yellow(`\n🔒 ${feature} requires a license.\n`)
  );
  console.log(
    "Purchase at: " +
      chalk.bold("https://drakonsystems.com/products/agent-optimizer/buy")
  );
  console.log(
    "Then activate: " +
      chalk.dim("agent-optimizer activate <key>") +
      "\n"
  );
  console.log(chalk.dim("Pricing:"));
  for (const tier of PRICING) {
    console.log(
      `  ${tier.name.padEnd(20)} £${(tier.price / 100).toFixed(0).padStart(3)}  ${tier.description}`
    );
  }
  console.log();
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
    console.log(chalk.bold("\n🔑 Drakon Systems — License Activation\n"));

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
    const license = loadLicense();
    if (!license) {
      console.log(chalk.yellow("\nNo license installed.\n"));
      console.log("Free: " + chalk.white("agent-optimizer audit") + " and " + chalk.white("agent-optimizer scan"));
      console.log("Paid: " + chalk.dim("optimize --fix, fleet"));
      console.log("\nPurchase: https://drakonsystems.com/products/agent-optimizer/buy");
      console.log("Activate: agent-optimizer activate <key>\n");
      return;
    }

    const check = validateLicense(license);
    console.log(chalk.bold("\n🔑 License Status\n"));
    console.log(`  Key:     ${license.key}`);
    console.log(`  Tier:    ${license.data.tier}`);
    console.log(`  Email:   ${license.data.email}`);
    console.log(`  Issued:  ${license.data.issuedAt}`);
    console.log(
      `  Expires: ${license.data.expiresAt ?? "Never (lifetime)"}`
    );
    console.log(
      `  Status:  ${check.valid ? chalk.green("Valid") : chalk.red(check.reason!)}`
    );
    console.log(`  Fleet:   ${canUseFleet(license.data.tier) ? "Yes" : "No (upgrade to Fleet or Lifetime)"}`);
    console.log(chalk.dim(`\n  File: ${getLicensePath()}\n`));
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
    console.log(chalk.bold("\n🦞 Agent Optimizer — Update\n"));
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
        console.log(chalk.bold("\n🔍 Drakon Systems — Agent Optimizer\n"));
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

    console.log(chalk.bold("\n🔍 Drakon Systems — Agent Optimizer\n"));
    const results = await runFullAudit(opts);
    generateReport(results, opts);

    // If no license, show the upsell after results
    if (!hasValidLicense()) {
      const warns = results.summary.warn;
      const fails = results.summary.fail;
      if (warns > 0 || fails > 0) {
        console.log(
          chalk.dim(
            "─────────────────────────────────────────────────────"
          )
        );
        console.log(
          chalk.yellow(
            `\n🦞 Found ${fails} critical and ${warns} warnings. Want to fix them automatically?`
          )
        );
        console.log(
          `   Run: ${chalk.white("agent-optimizer optimize")} to preview recommended changes (free)`
        );
        console.log(
          `   Run: ${chalk.white("agent-optimizer audit --fix")} to auto-apply fixes (requires license)\n`
        );
        console.log(
          chalk.dim(
            "   License: https://drakonsystems.com/products/agent-optimizer/buy\n"
          )
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
    console.log(chalk.bold("\n🛡️  Drakon Systems — Security Scanner\n"));
    const { runSecurityScan } = await import("./auditors/security-scan.js");
    const results = await runSecurityScan(opts);

    if (!hasValidLicense() && results.length > 0) {
      const suspicious = results.filter((r) => r.status === "warn" || r.status === "fail");
      if (suspicious.length > 0) {
        console.log(
          chalk.dim(
            "\n─────────────────────────────────────────────────────"
          )
        );
        console.log(
          chalk.yellow(
            `\n🦞 Found ${suspicious.length} suspicious pattern(s). Full fleet scanning available with a license.`
          )
        );
        console.log(
          chalk.dim(
            "   https://drakonsystems.com/products/agent-optimizer/buy\n"
          )
        );
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
  .action(async (opts) => {
    const licensed = hasValidLicense();

    // If no license, always run as dry-run (free preview)
    const effectiveDryRun = opts.dryRun || !licensed;

    console.log(chalk.bold("\n⚡ Drakon Systems — Agent Optimizer\n"));
    const { runOptimize } = await import("./optimizers/index.js");
    await runOptimize({ ...opts, dryRun: effectiveDryRun });

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

    console.log(chalk.bold("\n🔄 Drakon Systems — Rollback\n"));

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

program
  .command("fleet")
  .description("Audit multiple OpenClaw instances via SSH (requires Fleet/Lifetime license)")
  .option("--hosts <hosts>", "Comma-separated list of SSH hosts")
  .option("--ssh-config <path>", "Path to SSH config file", "~/.ssh/config")
  .option("--json", "Output results as JSON")
  .action(async (opts) => {
    requireLicense("fleet");
    console.log(chalk.bold("\n🚀 Drakon Systems — Fleet Audit\n"));
    const { runFleetAudit } = await import("./auditors/fleet.js");
    await runFleetAudit(opts);
  });

program.parse();
