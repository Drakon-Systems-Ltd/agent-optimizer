import { execSync } from "child_process";

const CRON_MARKER = "# agent-optimizer monitor";
const CRON_LINE = `0 2 * * * agent-optimizer monitor run >/dev/null 2>&1 ${CRON_MARKER}`;

function readCrontab(): string {
  try {
    return execSync("crontab -l", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    // Empty crontab or no crontab for user — both are fine
    return "";
  }
}

function writeCrontab(contents: string): void {
  // Use a heredoc via stdin to avoid tmp files
  const { spawnSync } = require("child_process") as typeof import("child_process");
  const result = spawnSync("crontab", ["-"], {
    input: contents,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`crontab write failed: ${result.stderr}`);
  }
}

export function isCronSupported(): boolean {
  if (process.platform === "win32") return false;
  try {
    execSync("which crontab", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function isCronInstalled(): boolean {
  return readCrontab().includes(CRON_MARKER);
}

export function installCron(): void {
  if (!isCronSupported()) {
    throw new Error(
      "cron is not supported on this platform. Monitoring requires cron (macOS/Linux)."
    );
  }
  if (isCronInstalled()) return;
  const current = readCrontab();
  const next = current.trim() + (current.trim() ? "\n" : "") + CRON_LINE + "\n";
  writeCrontab(next);
}

export function removeCron(): boolean {
  if (!isCronSupported()) return false;
  const current = readCrontab();
  if (!current.includes(CRON_MARKER)) return false;
  const filtered = current
    .split("\n")
    .filter((line) => !line.includes(CRON_MARKER))
    .join("\n");
  writeCrontab(filtered);
  return true;
}
