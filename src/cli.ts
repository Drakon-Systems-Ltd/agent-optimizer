#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { runFullAudit } from "./auditors/index.js";
import { generateReport } from "./reporters/index.js";

const program = new Command();

program
  .name("agent-optimizer")
  .description(
    "OpenClaw Agent Optimizer by Drakon Systems — audit, optimize, and secure your OpenClaw deployment"
  )
  .version("0.1.0");

program
  .command("audit")
  .description("Run a full audit of your OpenClaw installation")
  .option("-c, --config <path>", "Path to openclaw.json", "~/.openclaw/openclaw.json")
  .option("-a, --agent-dir <path>", "Path to agent directory")
  .option("--json", "Output results as JSON")
  .option("--fix", "Apply safe fixes automatically")
  .option("--deep", "Include live gateway probes")
  .action(async (opts) => {
    console.log(
      chalk.bold("\n🔍 Drakon Systems — Agent Optimizer\n")
    );
    const results = await runFullAudit(opts);
    generateReport(results, opts);
  });

program
  .command("optimize")
  .description("Apply recommended optimizations")
  .option("-c, --config <path>", "Path to openclaw.json", "~/.openclaw/openclaw.json")
  .option("--dry-run", "Show what would change without applying")
  .option("--profile <name>", "Optimization profile: minimal | balanced | aggressive", "balanced")
  .action(async (opts) => {
    console.log(
      chalk.bold("\n⚡ Drakon Systems — Agent Optimizer\n")
    );
    const { runOptimize } = await import("./optimizers/index.js");
    await runOptimize(opts);
  });

program
  .command("scan")
  .description("Scan installed skills and plugins for billing, malware, or suspicious patterns")
  .option("-c, --config <path>", "Path to openclaw.json", "~/.openclaw/openclaw.json")
  .option("--workspace <path>", "Path to workspace directory")
  .action(async (opts) => {
    console.log(
      chalk.bold("\n🛡️  Drakon Systems — Security Scanner\n")
    );
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
    console.log(
      chalk.bold("\n🚀 Drakon Systems — Fleet Audit\n")
    );
    const { runFleetAudit } = await import("./auditors/fleet.js");
    await runFleetAudit(opts);
  });

program.parse();
