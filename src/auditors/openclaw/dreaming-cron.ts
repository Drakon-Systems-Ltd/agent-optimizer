import { existsSync, readFileSync } from "fs";
import { expandPath } from "../../utils/config.js";
import type { AuditResult, OpenClawConfig } from "../../types.js";

const DREAMING_PATTERN = /dreaming/i;

function isMainSession(session: unknown): boolean {
  return typeof session === "string" && /(^|:)main:main($|:)/.test(session);
}

function jobMentionsDreaming(job: unknown): boolean {
  if (!job || typeof job !== "object") return false;
  const j = job as Record<string, unknown>;
  return (
    DREAMING_PATTERN.test(String(j.label ?? "")) ||
    DREAMING_PATTERN.test(String(j.module ?? "")) ||
    DREAMING_PATTERN.test(String(j.command ?? ""))
  );
}

export function auditDreamingCron(_config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];
  const cronPath = expandPath("~/.openclaw/cron/jobs.json");
  if (!existsSync(cronPath)) return results;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(cronPath, "utf-8"));
  } catch {
    results.push({
      category: "Dreaming Cron",
      check: "jobs.json parse",
      status: "info",
      message: `Could not parse ${cronPath} as JSON — skipping dreaming-cron migration check.`,
    });
    return results;
  }

  const jobs = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown> | null)?.jobs)
      ? ((parsed as Record<string, unknown>).jobs as unknown[])
      : [];

  for (const job of jobs) {
    if (!jobMentionsDreaming(job)) continue;
    const j = job as Record<string, unknown>;
    if (isMainSession(j.session)) {
      const id = (j.id as string) ?? (j.label as string) ?? "(unnamed)";
      results.push({
        category: "Dreaming Cron",
        check: `Stale dreaming job "${id}"`,
        status: "warn",
        message:
          "Dreaming cron job is tied to the main agent session — OpenClaw v2026.4.23 runs dreaming as an isolated lightweight agent turn decoupled from heartbeat. Unmigrated jobs still run old-shape.",
        fix: "Run `openclaw doctor --fix` to migrate the job to the new shape.",
      });
    }
  }

  return results;
}
