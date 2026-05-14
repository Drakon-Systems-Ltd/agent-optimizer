import ora from "ora";
import chalk from "chalk";
import type { AuditOptions, AuditReport, AuditResult, DetectedSystem } from "../types.js";
import { loadConfig, findAgentDir, detectOpenClawVersion } from "../utils/config.js";
import { detectSystems } from "../detect/index.js";
import { runOpenClawAuditors } from "./openclaw/index.js";

export async function runFullAudit(opts: AuditOptions & { silent?: boolean }): Promise<AuditReport> {
  const showProgress = !opts.json && !opts.silent;

  const detected = detectSystems();
  const openclawSystem = detected.find((s) => s.kind === "openclaw") ?? null;

  // Resolve OpenClaw config. If detection found OpenClaw, use it as preferred.
  // Otherwise fall back to opts.config (user passed --config to a non-standard path).
  const config = loadConfig(opts.config);
  if (!config) {
    console.error(`Config not found: ${opts.config}`);
    process.exit(1);
  }

  const agentDir = opts.agentDir ?? findAgentDir(config);

  // Determine version: prefer detected OpenClaw version, fall back to live CLI detection
  let openclawVersion: string = "unknown";
  if (showProgress) {
    const vSpinner = ora({ text: chalk.dim("Detecting OpenClaw version..."), color: "red" }).start();
    openclawVersion = openclawSystem?.version ?? detectOpenClawVersion() ?? "unknown";
    if (openclawVersion !== "unknown") {
      vSpinner.succeed(chalk.dim(`OpenClaw ${openclawVersion}`));
    } else {
      vSpinner.info(chalk.dim("OpenClaw version not detected"));
    }
  } else {
    openclawVersion = openclawSystem?.version ?? detectOpenClawVersion() ?? "unknown";
  }

  // Ensure systems list always contains an entry for the OpenClaw config we audited,
  // even if detection didn't find ~/.openclaw/openclaw.json (e.g. user passed --config to a non-standard path)
  const systems: DetectedSystem[] = openclawSystem
    ? [...detected]
    : [
        ...detected,
        {
          kind: "openclaw",
          version: openclawVersion === "unknown" ? null : openclawVersion,
          configPath: opts.config,
          scope: "user",
        },
      ];

  // Dispatch per system. Today only OpenClaw has auditors; v0.11.0 adds Claude Code + Cursor.
  const results: AuditResult[] = [];
  for (const system of systems) {
    if (system.kind === "openclaw") {
      results.push(
        ...runOpenClawAuditors({ config, agentDir, openclawVersion, showProgress })
      );
    }
    // Future: if (system.kind === "claude-code") { results.push(...runClaudeCodeAuditors(...)); }
  }

  const summary = {
    total: results.length,
    pass: results.filter((r) => r.status === "pass").length,
    warn: results.filter((r) => r.status === "warn").length,
    fail: results.filter((r) => r.status === "fail").length,
  };

  return {
    timestamp: new Date().toISOString(),
    host: "localhost",
    systems,
    openclawVersion,
    results,
    summary,
  };
}
