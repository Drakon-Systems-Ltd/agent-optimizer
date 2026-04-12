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

const program = new Command();

program
  .name("agent-optimizer")
  .description(
    "OpenClaw Agent Optimizer by Drakon Systems — audit, optimize, and secure your OpenClaw deployment"
  )
  .version("0.1.0");

// --- License gate ---

function requireLicense(command: string): License {
  const license = loadLicense();
  if (!license) {
    console.log(chalk.red("\n✗ No license found.\n"));
    console.log("Purchase a license at: https://drakonsystems.com/agent-optimizer");
    console.log("Then activate with: agent-optimizer activate <license-key>\n");
    console.log(chalk.dim("Pricing:"));
    for (const tier of PRICING) {
      console.log(
        `  ${tier.name.padEnd(20)} £${(tier.price / 100).toFixed(0).padStart(3)}  ${tier.description}`
      );
    }
    console.log();
    process.exit(1);
  }

  const check = validateLicense(license);
  if (!check.valid) {
    console.log(chalk.red(`\n✗ License invalid: ${check.reason}\n`));
    console.log("Renew at: https://drakonsystems.com/agent-optimizer");
    process.exit(1);
  }

  if (command === "fleet" && !canUseFleet(license.data.tier)) {
    console.log(
      chalk.red("\n✗ Fleet audit requires a Fleet or Lifetime license.\n")
    );
    console.log("Upgrade at: https://drakonsystems.com/agent-optimizer");
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

    // Validate key format: AO-XXXX-XXXXXXXX-XXXXXXXX
    if (!/^AO-[A-Z]{3,4}-[A-F0-9]{8}-[A-F0-9]{8}$/.test(key)) {
      console.log(chalk.red("Invalid key format."));
      console.log(chalk.dim("Expected: AO-XXXX-XXXXXXXX-XXXXXXXX"));
      process.exit(1);
    }

    // Verify against the licensing server
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
      console.log("Purchase: https://drakonsystems.com/agent-optimizer");
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

// --- Core commands (license-gated) ---

program
  .command("audit")
  .description("Run a full audit of your OpenClaw installation")
  .option(
    "-c, --config <path>",
    "Path to openclaw.json",
    "~/.openclaw/openclaw.json"
  )
  .option("-a, --agent-dir <path>", "Path to agent directory")
  .option("--json", "Output results as JSON")
  .option("--fix", "Apply safe fixes automatically")
  .option("--deep", "Include live gateway probes")
  .action(async (opts) => {
    requireLicense("audit");
    console.log(chalk.bold("\n🔍 Drakon Systems — Agent Optimizer\n"));
    const results = await runFullAudit(opts);
    generateReport(results, opts);
  });

program
  .command("optimize")
  .description("Apply recommended optimizations")
  .option(
    "-c, --config <path>",
    "Path to openclaw.json",
    "~/.openclaw/openclaw.json"
  )
  .option("--dry-run", "Show what would change without applying")
  .option(
    "--profile <name>",
    "Optimization profile: minimal | balanced | aggressive",
    "balanced"
  )
  .action(async (opts) => {
    requireLicense("optimize");
    console.log(chalk.bold("\n⚡ Drakon Systems — Agent Optimizer\n"));
    const { runOptimize } = await import("./optimizers/index.js");
    await runOptimize(opts);
  });

program
  .command("scan")
  .description(
    "Scan installed skills and plugins for billing, malware, or suspicious patterns"
  )
  .option(
    "-c, --config <path>",
    "Path to openclaw.json",
    "~/.openclaw/openclaw.json"
  )
  .option("--workspace <path>", "Path to workspace directory")
  .action(async (opts) => {
    requireLicense("scan");
    console.log(chalk.bold("\n🛡️  Drakon Systems — Security Scanner\n"));
    const { runSecurityScan } = await import("./auditors/security-scan.js");
    await runSecurityScan(opts);
  });

program
  .command("fleet")
  .description("Audit multiple OpenClaw instances via SSH")
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
