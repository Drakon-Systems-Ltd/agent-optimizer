#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { runFullAudit } from "./auditors/index.js";
import { stampFindingIds } from "./utils/finding-id.js";
import { generateReport, printBanner, printScanResults, buildScanReport } from "./reporters/index.js";
import {
  enrollMonitor,
  runMonitor,
  monitorStatus,
  disableMonitor,
  testMonitor,
  installCronOnly,
} from "./monitor/index.js";
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
import { emitPlanError } from "./utils/cli-json.js";

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
      `    ${w("rollback")} ${d("[--list] [--to <id>]")}              ${d("Restore a backup generation")}`,
      "",
      d("  FLEET") + d(" (£79+)"),
      `    ${w("fleet")} ${d("--hosts a,b,c [--json]")}             ${d("SSH fleet audit")}`,
      "",
      d("  MONITOR") + d(" (free beta — weekly email report)"),
      `    ${w("monitor enroll")} ${d("<email>")}                     ${d("Enrol for daily monitoring")}`,
      `    ${w("monitor status")}                             ${d("Show enrolment")}`,
      `    ${w("monitor disable")}                            ${d("Remove monitoring")}`,
      "",
      d("  UTILITY"),
      `    ${w("buy")} ${d("[--tier solo|fleet]")}                    ${d("Open purchase page")}`,
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

function printFixSummary(
  result: import("./fixers/index.js").FixApplyResult,
  manualCount: number,
  out: (msg: string) => void = console.log,
  applySuccess?: (backupId: string) => string
): void {
  if (result.applied === 0) {
    out(chalk.dim("\n  No changes written (fixes were already applied or files unavailable)."));
    return;
  }

  if (result.dryRun) {
    out(
      chalk.bold(`\n  Dry run — ${result.applied} fix(es) across ${result.files.length} file(s) would be applied:`)
    );
    for (const f of result.files) {
      out(`    ${chalk.yellow("→")} ${f.file} ${chalk.dim(`(${f.opsApplied} change${f.opsApplied === 1 ? "" : "s"})`)}`);
    }
    out(chalk.dim("\n  Run without --dry-run to apply."));
  } else {
    out(
      chalk.green(`\n  ✓ Applied ${result.applied} fix(es) across ${result.files.length} file(s)`)
    );
    for (const f of result.files) {
      out(`    ${chalk.green("✓")} ${f.file} ${chalk.dim(`(${f.opsApplied} change${f.opsApplied === 1 ? "" : "s"})`)}`);
    }
    // The backup generation snapshots every touched file (config + models.json),
    // so a single restore brings them all back atomically. Shared footer keeps
    // this identical to the optimize-apply success output.
    if (result.backupId && applySuccess) {
      out(applySuccess(result.backupId));
    }
  }

  if (manualCount > 0) {
    out(chalk.dim(`\n  Note: ${manualCount} other fixable finding(s) need manual action — see fix text above.`));
  }
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

// --- Monitor commands (subscription — Phase 1) ---

const monitor = program
  .command("monitor")
  .description("Daily monitoring + weekly email digest (free beta)");

monitor
  .command("enroll <email>")
  .description("Enrol this agent for daily monitoring")
  .option("--name <name>", "Agent name (defaults to hostname)")
  .option(
    "-c, --config <path>",
    "Path to openclaw.json",
    "~/.openclaw/openclaw.json"
  )
  .action(async (email: string, opts: { name?: string; config: string }) => {
    printBanner();
    await enrollMonitor({
      email,
      agentName: opts.name,
      configPath: opts.config,
    });
  });

monitor
  .command("run")
  .description("Run the audit silently and ping the server (called by cron)")
  .option(
    "-c, --config <path>",
    "Path to openclaw.json",
    "~/.openclaw/openclaw.json"
  )
  .action(async (opts: { config: string }) => {
    // No banner — this is silent cron-invoked
    await runMonitor({ configPath: opts.config });
  });

monitor
  .command("status")
  .description("Show monitor enrolment status")
  .action(() => {
    printBanner();
    monitorStatus();
  });

monitor
  .command("test")
  .description("Dry-run the audit and preview the payload (no POST)")
  .option(
    "-c, --config <path>",
    "Path to openclaw.json",
    "~/.openclaw/openclaw.json"
  )
  .action(async (opts: { config: string }) => {
    printBanner();
    await testMonitor({ configPath: opts.config });
  });

monitor
  .command("disable")
  .description("Remove cron entry, delete local state, notify server")
  .action(async () => {
    printBanner();
    await disableMonitor();
  });

monitor
  .command("install-cron")
  .description("Install the daily cron entry (for recovery if enroll failed partway)")
  .action(() => {
    printBanner();
    installCronOnly();
  });

program
  .command("buy")
  .description("Open the purchase page in your browser")
  .option("--tier <tier>", "Pre-select tier: solo | fleet | lifetime", "fleet")
  .action(async (opts) => {
    const url = `https://drakonsystems.com/products/agent-optimizer/buy?tier=${opts.tier}`;
    printBanner();
    console.log(chalk.dim("  Opening: ") + chalk.white(url) + "\n");

    // Cross-platform browser open
    const { exec } = await import("child_process");
    const platform = process.platform;
    const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
    exec(`${cmd} "${url}"`, (err) => {
      if (err) {
        console.log(chalk.dim("  Could not open browser. Visit the URL above manually.\n"));
      }
    });
  });

// --- Free commands (audit + scan show results, fixes are gated) ---

program
  .command("detect")
  .description("List detected Claude-family agent systems (Claude Code, OpenClaw, Cursor)")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const { detectSystems } = await import("./detect/index.js");
    const systems = detectSystems();
    if (opts.json) {
      console.log(JSON.stringify(systems, null, 2));
      return;
    }
    if (systems.length === 0) {
      console.log(chalk.dim("No Claude-family agent systems detected in this directory or home."));
      return;
    }
    console.log(chalk.bold("Detected systems:"));
    for (const s of systems) {
      const ver = s.version ? chalk.cyan(` v${s.version}`) : "";
      console.log(`  ${chalk.bold(s.kind)}${ver} ${chalk.dim(`(${s.scope})`)} → ${chalk.dim(s.configPath)}`);
    }
  });

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
  .option("--dry-run", "With --fix: preview the fixes without writing any files")
  .option("--deep", "Include live gateway probes")
  .action(async (opts) => {
    const licensed = !!hasValidLicense();

    if (opts.fix && !licensed) {
      printBanner(!!opts.json);
      const results = await runFullAudit(opts);
      generateReport(results, { ...opts, licensed: false });
      console.log(chalk.red(`  ░░ --fix requires a license to apply changes.\n`));
      printUpgradePrompt("Auto-fix");
      process.exit(1);
    }

    printBanner(!!opts.json);
    const results = await runFullAudit(opts);
    generateReport(results, { ...opts, licensed });

    if (opts.fix) {
      // In --json mode, keep stdout clean: send all fix-summary text to stderr.
      const out = opts.json ? console.error : console.log;
      const { applyFixes, findingsWithFixes, autoFixableWithoutPayload } =
        await import("./fixers/index.js");
      const { loadConfig, findAgentDir } = await import("./utils/config.js");
      const { formatApplyError, formatApplySuccess } = await import("./utils/apply-errors.js");

      const fixable = findingsWithFixes(results);
      const manual = autoFixableWithoutPayload(results);

      if (fixable.length === 0) {
        out(chalk.dim("\n  No machine-applicable fixes found."));
        if (manual > 0) {
          out(chalk.dim(`  (${manual} fixable finding(s) need manual action — see fix text above)`));
        }
        return;
      }

      const config = loadConfig(opts.config);
      const agentDir = opts.agentDir ?? (config ? findAgentDir(config) : "~/.openclaw/agents/main/agent");
      try {
        const result = applyFixes(results, { configPath: opts.config, agentDir, dryRun: !!opts.dryRun });
        printFixSummary(result, manual, out, formatApplySuccess);
      } catch (err) {
        // The four transactionalApply errors (rolled-back / rollback-failed /
        // locked / precondition) get the shared human formatting + exit code.
        const { text, exitCode } = formatApplyError(err);
        out(text);
        process.exitCode = exitCode;
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
  .option("--json", "Output results as JSON (banner to stderr; no license nag)")
  .action(async (opts) => {
    const { runSecurityScan } = await import("./auditors/openclaw/security-scan.js");

    if (opts.json) {
      // Machine path: banner to stderr, PURE JSON on stdout (id-stamped results +
      // status summary). No human table, no license nag — `scan --json | jq` must
      // parse. `untrusted: true` on third-party findings is preserved faithfully.
      printBanner(true);
      const results = await runSecurityScan(opts);
      console.log(JSON.stringify(buildScanReport(results), null, 2));
      return;
    }

    printBanner();
    console.log(chalk.dim("  mode: ") + chalk.white("security scan\n"));
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
    "--plan",
    "Emit a persisted machine-readable plan as JSON on stdout (free, read-only)"
  )
  .option(
    "--apply-plan <id>",
    "Apply a persisted plan by id, transactionally, with a config-drift guard (licensed, mutates). Pure JSON on stdout. In this mode --only selects PROPOSAL IDS, not tags."
  )
  .option(
    "--profile <name>",
    "Optimization profile: minimal | balanced | aggressive",
    "balanced"
  )
  .option(
    // Mode-dependent: in the normal optimize path these are TAGS; with
    // --apply-plan they are PROPOSAL IDS (e.g. p1-context,p3-heartbeat).
    "--only <tags>",
    "Only apply these optimizations (comma-separated tags: context,heartbeat,subagents,compaction,pruning). With --apply-plan: comma-separated PROPOSAL IDS instead."
  )
  .option(
    "--skip <tags>",
    "Skip these optimizations (comma-separated: context,heartbeat,subagents,compaction,pruning)"
  )
  .option(
    "--system <kind>",
    "Target system: claude-code | openclaw (auto-detected if omitted)"
  )
  .option(
    // Accepted-and-ignored: --plan and --apply-plan are ALWAYS-JSON machine verbs,
    // so a redundant --json (Task 11/12's documented invocation) is absorbed rather
    // than rejected by commander (which would emit "unknown option" + exit 1, an
    // error an agent can't distinguish from a real failure). Output is unchanged.
    "--json",
    "Accepted for the machine verbs (--plan / --apply-plan already emit JSON); ignored otherwise"
  )
  .action(async (opts) => {
    if (opts.plan) {
      // Free, read-only: no license check. Stdout carries pure JSON (the
      // persisted plan, byte-for-byte); everything human goes to stderr.
      printBanner(true);
      const { buildPlan, savePlan } = await import("./optimizers/plan.js");
      try {
        const plan = buildPlan(opts.config, opts.profile);
        const file = savePlan(plan);
        console.error(chalk.dim(`  plan saved: ${file}\n`));
        console.log(JSON.stringify(plan, null, 2));
      } catch (err) {
        // Shared envelope so --plan and --apply-plan errors read identically.
        emitPlanError("plan-failed", (err as Error).message, { configPath: opts.config });
        process.exit(1);
      }
      return;
    }

    if (opts.applyPlan) {
      // Apply-plan is the agent-facing MACHINE path: pure JSON on stdout, banner
      // and any human text to stderr — exactly like --plan. It MUTATES, so it is
      // license-gated (runApplyPlan enforces this via the injected `licensed`).
      printBanner(true);
      const { runApplyPlan } = await import("./optimizers/apply-plan.js");
      const { json, exitCode } = runApplyPlan({
        config: opts.config,
        applyPlan: opts.applyPlan,
        // Raw --only string: in apply-plan mode these are PROPOSAL IDS, not tags.
        // runApplyPlan splits/validates them against the plan.
        only: opts.only,
        licensed: !!hasValidLicense(),
      });
      console.log(JSON.stringify(json, null, 2));
      if (exitCode !== 0) process.exit(exitCode);
      return;
    }

    const licensed = hasValidLicense();
    const effectiveDryRun = opts.dryRun || !licensed;

    // Parse comma-separated tags
    const only = opts.only ? opts.only.split(",").map((t: string) => t.trim()) : undefined;
    const skip = opts.skip ? opts.skip.split(",").map((t: string) => t.trim()) : undefined;

    // Validate --system flag
    if (opts.system && opts.system !== "claude-code" && opts.system !== "openclaw") {
      console.log(chalk.red(`Invalid --system value: "${opts.system}". Use claude-code or openclaw.`));
      process.exit(1);
    }

    printBanner();
    console.log(chalk.dim("  mode: ") + chalk.white("optimize") + chalk.dim(` · ${effectiveDryRun ? "dry-run" : "apply"} · ${opts.profile}${opts.system ? ` · ${opts.system}` : ""}\n`));
    const { runOptimize } = await import("./optimizers/index.js");
    await runOptimize({ ...opts, dryRun: effectiveDryRun, only, skip, system: opts.system });

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
  .description("Restore config from a backup generation (store, with legacy sidecar fallback)")
  .option(
    "-c, --config <path>",
    "Path to openclaw.json",
    "~/.openclaw/openclaw.json"
  )
  .option("--list", "List the backup generations that touch this config")
  .option("--to <id>", "Restore a specific backup generation by id")
  .option("--json", "Output as JSON (banner to stderr; structured per mode)")
  .action(async (opts) => {
    const { runRollback } = await import("./utils/rollback.js");

    if (opts.json) {
      // Machine path: banner to stderr, PURE JSON on stdout. runRollback builds a
      // structured result per mode (list / restore / error) instead of printing.
      printBanner(true);
      const { exitCode, json } = runRollback({
        config: opts.config,
        list: opts.list,
        to: opts.to,
        json: true,
      });
      console.log(JSON.stringify(json, null, 2));
      if (exitCode) process.exitCode = exitCode;
      return;
    }

    printBanner();
    console.log(chalk.dim("  mode: ") + chalk.white("rollback\n"));

    const { exitCode } = runRollback({ config: opts.config, list: opts.list, to: opts.to });
    console.log();
    if (exitCode) process.exitCode = exitCode;
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
    const { saveSnapshot } = await import("./auditors/openclaw/config-drift.js");
    saveSnapshot(opts.config, opts.name);
  });

snapshot
  .command("list")
  .description("List saved snapshots")
  .action(async () => {
    const { listSnapshots } = await import("./auditors/openclaw/config-drift.js");
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
    const { detectDrift } = await import("./auditors/openclaw/config-drift.js");
    // Stamp ids/machineFixable so this report honours the schemaVersion:1 contract
    // (idful results) everywhere it is advertised, not just on `audit --json`.
    const results = stampFindingIds(detectDrift(opts.config, opts.name));
    generateReport(
      {
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        host: "localhost",
        systems: [],
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
    printBanner(!!opts.json);
    if (!opts.json) console.log(chalk.dim("  mode: ") + chalk.white("fleet audit\n"));
    const { runFleetAudit } = await import("./auditors/openclaw/fleet.js");
    await runFleetAudit(opts);
  });

program.parse();
