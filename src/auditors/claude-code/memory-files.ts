import { existsSync, readFileSync } from "fs";
import { dirname, resolve, isAbsolute } from "path";
import type { AuditResult } from "../../types.js";

function classifyScope(path: string): "user" | "project" {
  // ~/.claude/CLAUDE.md style → user; anything else → project
  return /\/\.claude\/CLAUDE\.md$/.test(path) ? "user" : "project";
}

export function auditMemoryFiles(claudeMdPaths: string[]): AuditResult[] {
  const results: AuditResult[] = [];
  if (claudeMdPaths.length === 0) return results;

  const present: Array<{ path: string; scope: "user" | "project"; content: string | null }> = [];

  for (const p of claudeMdPaths) {
    let content: string | null = null;
    try {
      content = readFileSync(p, "utf-8");
    } catch {
      results.push({
        category: "Memory Files",
        check: "CLAUDE.md readable",
        status: "warn",
        message: `Could not read ${p}`,
      });
      present.push({ path: p, scope: classifyScope(p), content: null });
      continue;
    }
    present.push({ path: p, scope: classifyScope(p), content });
  }

  // Size checks
  for (const entry of present) {
    if (entry.content === null) continue;
    const len = entry.content.length;
    const scope = entry.scope;
    if (len > 80_000) {
      results.push({
        category: "Memory Files",
        check: `CLAUDE.md size — ${scope} scope`,
        status: "fail",
        message: `${scope} CLAUDE.md is ${len} chars (>80K) — bloating every prompt`,
        fix: "Move detail into linked docs and keep CLAUDE.md as an index",
      });
    } else if (len > 40_000) {
      results.push({
        category: "Memory Files",
        check: `CLAUDE.md size — ${scope} scope`,
        status: "warn",
        message: `${scope} CLAUDE.md is ${len} chars (>40K) — review for trim opportunities`,
      });
    } else if (len > 20_000) {
      results.push({
        category: "Memory Files",
        check: `CLAUDE.md size — ${scope} scope`,
        status: "info",
        message: `${scope} CLAUDE.md is ${len} chars (>20K)`,
      });
    }
  }

  // Both present
  const hasUser = present.some((e) => e.scope === "user");
  const hasProject = present.some((e) => e.scope === "project");
  if (hasUser && hasProject) {
    results.push({
      category: "Memory Files",
      check: "Both user and project CLAUDE.md present",
      status: "info",
      message: "Both ~/.claude/CLAUDE.md and project CLAUDE.md are loaded — watch for duplication or drift",
    });
  }

  // Broken @-imports
  const importRe = /@([^\s)]+)/g;
  for (const entry of present) {
    if (entry.content === null) continue;
    const dir = dirname(entry.path);
    const matches = entry.content.matchAll(importRe);
    const broken: string[] = [];
    for (const m of matches) {
      const ref = m[1];
      // Skip emails and obvious non-paths (e.g. @username with no slash or dot)
      if (!ref.includes("/") && !ref.includes(".")) continue;
      // Skip URLs
      if (/^https?:\/\//.test(ref)) continue;
      const resolved = isAbsolute(ref) ? ref : resolve(dir, ref);
      if (!existsSync(resolved)) {
        broken.push(ref);
      }
    }
    for (const ref of broken) {
      results.push({
        category: "Memory Files",
        check: "Broken @-import",
        status: "warn",
        message: `${entry.scope} CLAUDE.md references "@${ref}" which does not exist`,
        fix: "Update the path or remove the reference",
      });
    }
  }

  return results;
}
