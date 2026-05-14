import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import type { AuditResult } from "../../types.js";

interface ExecApproval { command?: string; grantedAt?: string }
interface ExecApprovalsFile { approvals?: ExecApproval[]; socketPath?: string }

const NINETY_DAYS_MS = 90 * 86400000;

export function auditExecApprovals(): AuditResult[] {
  const results: AuditResult[] = [];
  const path = resolve(homedir(), ".openclaw", "exec-approvals.json");
  if (!existsSync(path)) {
    return results;
  }

  let data: ExecApprovalsFile;
  try {
    data = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    results.push({
      category: "Exec Approvals",
      check: "exec-approvals.json readable",
      status: "warn",
      message: "exec-approvals.json exists but is not valid JSON",
      fix: "Inspect or delete ~/.openclaw/exec-approvals.json",
    });
    return results;
  }

  const approvals = data.approvals ?? [];
  const stale = approvals.filter(a => {
    if (!a.grantedAt) return false;
    return Date.now() - new Date(a.grantedAt).getTime() > NINETY_DAYS_MS;
  });

  if (stale.length > 0) {
    results.push({
      category: "Exec Approvals",
      check: "Stale exec approvals",
      status: "warn",
      message: `${stale.length} exec approval(s) older than 90 days still active`,
      fix: "Review ~/.openclaw/exec-approvals.json and revoke unused entries",
    });
  }

  return results;
}
