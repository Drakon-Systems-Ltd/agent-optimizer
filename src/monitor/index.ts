import { hostname } from "os";
import chalk from "chalk";
import type { AuditReport, MonitorPingPayload, MonitorState } from "../types.js";
import { runFullAudit } from "../auditors/index.js";
import { detectOpenClawVersion } from "../utils/config.js";
import {
  DEFAULT_API_BASE,
  MONITOR_STATE_PATH,
  MONITOR_LOG_PATH,
  appendMonitorLog,
  clearMonitorState,
  loadMonitorState,
  saveMonitorState,
} from "./state.js";
import { installCron, isCronInstalled, isCronSupported, removeCron } from "./cron.js";

const red = chalk.red;
const green = chalk.green;
const yellow = chalk.yellow;
const dim = chalk.dim;
const white = chalk.bold.white;

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function calculateHealthScore(report: AuditReport): number {
  const { pass, warn, fail, total } = report.summary;
  if (total === 0) return 100;
  const info = total - pass - warn - fail;
  const score = ((pass + info) * 1.0 + warn * 0.4 + fail * 0) / total;
  return Math.round(score * 100);
}

function buildPingPayload(state: MonitorState, report: AuditReport): MonitorPingPayload {
  const { pass, warn, fail, total } = report.summary;
  const info = total - pass - warn - fail;
  return {
    token: state.token,
    timestamp: report.timestamp,
    openclawVersion: report.openclawVersion,
    healthScore: calculateHealthScore(report),
    summary: { pass, warn, fail, info, total },
    issues: report.results.map((r) => ({
      category: r.category,
      check: r.check,
      status: r.status,
    })),
  };
}

export async function enrollMonitor(opts: {
  email: string;
  agentName?: string;
  configPath: string;
}): Promise<void> {
  console.log(dim("  mode: ") + white("monitor enroll\n"));

  if (!validateEmail(opts.email)) {
    console.log(red(`  ░░ Invalid email: ${opts.email}\n`));
    process.exit(1);
  }

  if (loadMonitorState()) {
    console.log(
      yellow(
        "  ▓▓ Already enrolled. Run `agent-optimizer monitor disable` first.\n"
      )
    );
    process.exit(1);
  }

  if (!isCronSupported()) {
    console.log(
      red(
        "  ░░ Cron is not supported on this platform. Monitoring requires macOS or Linux.\n"
      )
    );
    process.exit(1);
  }

  const agentName = opts.agentName ?? hostname();
  const apiBase = DEFAULT_API_BASE;

  console.log(dim(`  Email:  ${opts.email}`));
  console.log(dim(`  Agent:  ${agentName}`));
  console.log(dim(`  Server: ${apiBase}\n`));

  // Call the enrollment endpoint
  let token: string;
  try {
    const response = await fetch(`${apiBase}/api/agent-optimizer/monitor/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: opts.email,
        agentName,
        openclawVersion: detectOpenClawVersion() ?? "unknown",
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.log(red(`  ░░ Enrollment failed: ${body}\n`));
      process.exit(1);
    }

    const json = (await response.json()) as { token: string };
    token = json.token;
  } catch (err) {
    console.log(
      red(
        `  ░░ Could not reach server: ${(err as Error).message}\n`
      )
    );
    process.exit(1);
  }

  // Save state
  const state: MonitorState = {
    token,
    email: opts.email,
    agentName,
    enrolledAt: new Date().toISOString(),
    apiBase,
  };
  saveMonitorState(state);

  // Install cron
  try {
    installCron();
  } catch (err) {
    console.log(
      yellow(
        `  ▓▓ Enrolled but could not install cron: ${(err as Error).message}\n`
      )
    );
    console.log(dim("  You can run `agent-optimizer monitor run` manually.\n"));
    return;
  }

  console.log(green("  ██ Enrolled\n"));
  console.log(dim("  ┌─────────────────────────────────────────────┐"));
  console.log(dim("  │ ") + dim("Next scan:") + white("  tomorrow at 02:00 (cron)".padEnd(33)) + dim("│"));
  console.log(dim("  │ ") + dim("Weekly email: Sunday 18:00 UTC") + dim("             │"));
  console.log(dim("  │ ") + dim("State file: ") + dim(MONITOR_STATE_PATH.replace(process.env.HOME ?? "", "~").padEnd(32)) + dim("│"));
  console.log(dim("  └─────────────────────────────────────────────┘\n"));
  console.log(dim("  Disable anytime with: agent-optimizer monitor disable\n"));
}

export async function runMonitor(opts: { configPath: string }): Promise<void> {
  const state = loadMonitorState();
  if (!state) {
    appendMonitorLog("ERROR: No monitor state — enroll first");
    console.error("Not enrolled. Run: agent-optimizer monitor enroll <email>");
    process.exit(1);
  }

  try {
    const report = await runFullAudit({
      config: opts.configPath,
      silent: true,
    } as any);

    const payload = buildPingPayload(state, report);

    const response = await fetch(`${state.apiBase}/api/agent-optimizer/monitor/ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      appendMonitorLog(`PING FAILED ${response.status}: ${body}`);
      process.exit(1);
    }

    appendMonitorLog(
      `PING OK score=${payload.healthScore} issues=${payload.summary.total}`
    );
  } catch (err) {
    appendMonitorLog(`PING ERROR: ${(err as Error).message}`);
    process.exit(1);
  }
}

export async function testMonitor(opts: { configPath: string }): Promise<void> {
  console.log(dim("  mode: ") + white("monitor test (dry-run)\n"));

  const state = loadMonitorState();
  if (!state) {
    console.log(red("  ░░ Not enrolled. Run: agent-optimizer monitor enroll <email>\n"));
    process.exit(1);
  }

  const report = await runFullAudit({ config: opts.configPath } as any);
  const payload = buildPingPayload(state, report);

  console.log(green("  ██ Would send this payload:\n"));
  console.log(dim(JSON.stringify({
    ...payload,
    token: payload.token.slice(0, 8) + "…",
    issues: `[${payload.issues.length} items]`,
  }, null, 2)));
  console.log();
}

export function monitorStatus(): void {
  console.log(dim("  mode: ") + white("monitor status\n"));

  const state = loadMonitorState();
  if (!state) {
    console.log(red("  ░░ Not enrolled.\n"));
    console.log(dim("  Run: agent-optimizer monitor enroll <email>\n"));
    return;
  }

  const cronOk = isCronInstalled();

  console.log(dim("  ┌─────────────────────────────────────────────┐"));
  console.log(dim("  │ ") + dim("Email     ") + white(state.email.padEnd(35)) + dim("│"));
  console.log(dim("  │ ") + dim("Agent     ") + white(state.agentName.padEnd(35)) + dim("│"));
  console.log(dim("  │ ") + dim("Enrolled  ") + white(new Date(state.enrolledAt).toLocaleDateString().padEnd(35)) + dim("│"));
  console.log(dim("  │ ") + dim("Cron      ") + (cronOk ? green("Installed".padEnd(35)) : red("Not installed".padEnd(35))) + dim("│"));
  console.log(dim("  │ ") + dim("Server    ") + white(state.apiBase.padEnd(35)) + dim("│"));
  console.log(dim("  └─────────────────────────────────────────────┘\n"));

  console.log(dim(`  Log: ${MONITOR_LOG_PATH.replace(process.env.HOME ?? "", "~")}\n`));
}

export async function disableMonitor(): Promise<void> {
  console.log(dim("  mode: ") + white("monitor disable\n"));

  const state = loadMonitorState();
  if (!state) {
    console.log(yellow("  ▓▓ Not enrolled — nothing to disable.\n"));
    return;
  }

  // Notify server (best-effort)
  try {
    await fetch(`${state.apiBase}/api/agent-optimizer/monitor/disable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: state.token }),
    });
  } catch {
    // Server unreachable — local cleanup still happens
  }

  removeCron();
  clearMonitorState();

  console.log(green("  ██ Monitoring disabled\n"));
  console.log(dim("  · Cron entry removed"));
  console.log(dim("  · Local state deleted"));
  console.log(dim("  · Server notified\n"));
}
