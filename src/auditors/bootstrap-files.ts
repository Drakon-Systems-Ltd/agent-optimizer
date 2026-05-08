import { existsSync, readFileSync, statSync, readdirSync } from "fs";
import { join, resolve } from "path";
import type { AuditResult, OpenClawConfig } from "../types.js";
import { expandPath, findWorkspace } from "../utils/config.js";

const BOOTSTRAP_FILES = [
  "SOUL.md",
  "IDENTITY.md",
  "TOOLS.md",
  "MEMORY.md",
  "USER.md",
  "AGENTS.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
];

const DEFAULT_PER_FILE_MAX = 20000;
const DEFAULT_TOTAL_MAX = 150000;

export function auditBootstrapFiles(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];
  const defaults = config.agents?.defaults;
  const workspace = findWorkspace(config);
  const wsPath = expandPath(workspace);

  if (!existsSync(wsPath)) {
    results.push({
      category: "Bootstrap Files",
      check: "Workspace exists",
      status: "fail",
      message: `Workspace not found: ${workspace}`,
    });
    return results;
  }

  // Get configured limits (or defaults)
  const perFileMax = (defaults as Record<string, unknown>)?.bootstrapMaxChars as number ?? DEFAULT_PER_FILE_MAX;
  const totalMax = (defaults as Record<string, unknown>)?.bootstrapTotalMaxChars as number ?? DEFAULT_TOTAL_MAX;

  // MEMORY.md split-brain (v2026.4.23): both MEMORY.md and memory.md present in workspace root.
  // OpenClaw 2026.4.23 canonicalizes on MEMORY.md; `openclaw doctor --fix` merges the pair.
  // Use directory listing (case-sensitive) so we don't false-positive on case-insensitive FS
  // where existsSync("memory.md") returns true when only MEMORY.md is on disk.
  try {
    const rootEntries = readdirSync(wsPath);
    const hasUpper = rootEntries.includes("MEMORY.md");
    const hasLower = rootEntries.includes("memory.md");
    if (hasUpper && hasLower) {
      results.push({
        category: "Bootstrap Files",
        check: "MEMORY.md split-brain",
        status: "warn",
        message: "Both MEMORY.md and memory.md exist in workspace root — OpenClaw 2026.4.23 canonicalizes on MEMORY.md and will no longer treat memory.md as a runtime fallback.",
        fix: "Run `openclaw doctor --fix` to merge memory.md into MEMORY.md (creates a backup automatically).",
      });
    }
  } catch { /* unreadable workspace — other checks will catch it */ }

  let totalChars = 0;
  let filesFound = 0;
  let filesOverBudget = 0;
  const fileDetails: { name: string; chars: number; overBudget: boolean }[] = [];

  for (const filename of BOOTSTRAP_FILES) {
    const filePath = join(wsPath, filename);
    // Also check lowercase variant
    const filePathLower = join(wsPath, filename.toLowerCase());
    const actualPath = existsSync(filePath) ? filePath : existsSync(filePathLower) ? filePathLower : null;

    if (!actualPath) continue;

    filesFound++;
    const content = readFileSync(actualPath, "utf-8");
    const chars = content.length;
    totalChars += Math.min(chars, perFileMax); // OpenClaw truncates at perFileMax

    const overBudget = chars > perFileMax;
    if (overBudget) filesOverBudget++;

    fileDetails.push({ name: filename, chars, overBudget });

    if (overBudget) {
      const overBy = chars - perFileMax;
      const overPercent = ((overBy / perFileMax) * 100).toFixed(0);
      results.push({
        category: "Bootstrap Files",
        check: `${filename} size`,
        status: "fail",
        message: `${(chars / 1000).toFixed(1)}K chars — exceeds ${(perFileMax / 1000).toFixed(0)}K limit by ${(overBy / 1000).toFixed(1)}K (${overPercent}% over). Content will be TRUNCATED.`,
        fix: `Trim ${filename} to under ${(perFileMax / 1000).toFixed(0)}K chars`,
      });
    } else if (chars > perFileMax * 0.8) {
      results.push({
        category: "Bootstrap Files",
        check: `${filename} size`,
        status: "warn",
        message: `${(chars / 1000).toFixed(1)}K chars — at ${((chars / perFileMax) * 100).toFixed(0)}% of ${(perFileMax / 1000).toFixed(0)}K limit`,
        fix: `Consider trimming ${filename} to leave headroom`,
      });
    } else if (chars > 0) {
      results.push({
        category: "Bootstrap Files",
        check: `${filename} size`,
        status: "pass",
        message: `${(chars / 1000).toFixed(1)}K chars (${((chars / perFileMax) * 100).toFixed(0)}% of limit)`,
      });
    }
  }

  // Total budget check
  if (totalChars > totalMax) {
    const overBy = totalChars - totalMax;
    results.push({
      category: "Bootstrap Files",
      check: "Total bootstrap budget",
      status: "fail",
      message: `Total ${(totalChars / 1000).toFixed(1)}K chars exceeds ${(totalMax / 1000).toFixed(0)}K total budget by ${(overBy / 1000).toFixed(1)}K — some files may get 0 chars injected`,
      fix: "Reduce the largest files first. MEMORY.md and TOOLS.md are the usual culprits.",
    });
  } else if (totalChars > totalMax * 0.7) {
    results.push({
      category: "Bootstrap Files",
      check: "Total bootstrap budget",
      status: "warn",
      message: `Total ${(totalChars / 1000).toFixed(1)}K chars — at ${((totalChars / totalMax) * 100).toFixed(0)}% of ${(totalMax / 1000).toFixed(0)}K total budget`,
    });
  } else {
    results.push({
      category: "Bootstrap Files",
      check: "Total bootstrap budget",
      status: "pass",
      message: `Total ${(totalChars / 1000).toFixed(1)}K chars across ${filesFound} files (${((totalChars / totalMax) * 100).toFixed(0)}% of ${(totalMax / 1000).toFixed(0)}K budget)`,
    });
  }

  // Check for missing critical files
  const criticalFiles = ["SOUL.md", "IDENTITY.md"];
  for (const filename of criticalFiles) {
    const filePath = join(wsPath, filename);
    if (!existsSync(filePath)) {
      results.push({
        category: "Bootstrap Files",
        check: `${filename} exists`,
        status: "warn",
        message: `${filename} not found in workspace — agent has no ${filename === "SOUL.md" ? "personality" : "identity"} definition`,
        fix: `Create ${workspace}/${filename}`,
      });
    }
  }

  // Check for empty files
  for (const { name, chars } of fileDetails) {
    if (chars === 0) {
      results.push({
        category: "Bootstrap Files",
        check: `${name} content`,
        status: "warn",
        message: `${name} exists but is empty — wasting a bootstrap slot`,
        fix: `Add content or remove the file`,
      });
    }
  }

  // Check for memory/*.md files (these are NOT auto-injected, just informational)
  const memoryDir = join(wsPath, "memory");
  if (existsSync(memoryDir)) {
    try {
      const memoryFiles = readdirSync(memoryDir).filter((f) => f.endsWith(".md"));
      if (memoryFiles.length > 0) {
        const totalMemorySize = memoryFiles.reduce((sum, f) => {
          try { return sum + statSync(join(memoryDir, f)).size; } catch { return sum; }
        }, 0);
        results.push({
          category: "Bootstrap Files",
          check: "Memory files",
          status: "info",
          message: `${memoryFiles.length} memory files (${(totalMemorySize / 1000).toFixed(1)}K total) — loaded on-demand via memory tools, not auto-injected`,
        });
      }
    } catch { /* skip */ }
  }

  return results;
}
