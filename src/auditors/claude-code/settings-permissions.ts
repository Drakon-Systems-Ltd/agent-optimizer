import type { AuditResult } from "../../types.js";

export interface ClaudeCodeSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
    defaultMode?: string;
  };
  hooks?: Record<string, Array<{
    matcher?: string;
    hooks?: Array<{ type?: string; command?: string; timeout?: number }>;
  }>>;
  [key: string]: unknown;
}

const OVER_PERMISSIVE_WARN_PATTERNS = [
  /^Bash\(rm:.*\)$/,
  /^Bash\(sudo:.*\)$/,
  /^Bash\(curl:.*\)$/,
];

export function auditSettingsPermissions(
  settings: ClaudeCodeSettings,
  scope: "user" | "project",
): AuditResult[] {
  const results: AuditResult[] = [];
  const perms = settings.permissions;
  if (!perms) return results;

  const allow = perms.allow ?? [];
  const deny = perms.deny;

  // Empty allow + missing/empty deny
  if (allow.length === 0 && (!deny || deny.length === 0)) {
    results.push({
      category: "Permissions",
      check: "Empty allow and deny",
      status: "info",
      message: `${scope} settings.json has no allow or deny entries — relying entirely on defaultMode`,
    });
  }

  // Deny absent (but allow has entries)
  if (deny === undefined && allow.length > 0) {
    results.push({
      category: "Permissions",
      check: "Deny list absent",
      status: "info",
      message: `${scope} settings.json has an allow list but no deny list — consider adding a small denylist for high-risk commands`,
    });
  }

  // Allow list size
  if (allow.length > 1000) {
    results.push({
      category: "Permissions",
      check: "Allow list size",
      status: "fail",
      message: `${scope} allow list has ${allow.length} entries (>1000) — review and prune`,
      fix: "Audit allow entries and remove unused / overly specific permissions",
    });
  } else if (allow.length > 200) {
    results.push({
      category: "Permissions",
      check: "Allow list size",
      status: "warn",
      message: `${scope} allow list has ${allow.length} entries (>200) — getting hard to review`,
    });
  }

  // Over-permissive: Bash(*) and Read(*) — fail
  for (const entry of allow) {
    if (entry === "Bash(*)") {
      results.push({
        category: "Permissions",
        check: "Over-permissive: Bash(*)",
        status: "fail",
        message: `${scope} allow list contains "Bash(*)" — every bash command is permitted`,
        fix: "Replace with specific Bash(<cmd>:*) entries",
      });
    } else if (entry === "Read(*)") {
      results.push({
        category: "Permissions",
        check: "Over-permissive: Read(*)",
        status: "fail",
        message: `${scope} allow list contains "Read(*)" — every file is readable`,
        fix: "Replace with scoped Read(<path>) entries",
      });
    }
  }

  // Over-permissive: Bash(rm|sudo|curl:*) — warn
  for (const entry of allow) {
    for (const pat of OVER_PERMISSIVE_WARN_PATTERNS) {
      if (pat.test(entry)) {
        results.push({
          category: "Permissions",
          check: `Over-permissive: ${entry}`,
          status: "warn",
          message: `${scope} allow list contains "${entry}" — high-risk command wildcarded`,
        });
      }
    }
  }

  // Broad //Users/ path: starts with Read(//Users/ and has no further restrictive suffix like /** or specific file
  for (const entry of allow) {
    const m = entry.match(/^Read\(\/\/Users\/([^)]+)\)$/);
    if (m) {
      const inner = m[1];
      // Restrictive suffix: ends with a specific filename or /** or contains explicit file ext
      const looksRestricted = /\/\*\*$/.test(inner) || /\.[a-zA-Z0-9]+$/.test(inner);
      if (!looksRestricted) {
        results.push({
          category: "Permissions",
          check: `Over-permissive: ${entry}`,
          status: "warn",
          message: `${scope} allow entry "${entry}" is broad — consider narrowing to /** or specific files`,
        });
      }
    } else if (entry === "Read(//)") {
      results.push({
        category: "Permissions",
        check: "Over-permissive: Read(//)",
        status: "warn",
        message: `${scope} allow entry "Read(//)" grants root-level read access`,
      });
    }
  }

  // Allow/deny conflict
  if (deny && deny.length > 0) {
    const denySet = new Set(deny);
    const conflicts = allow.filter((a) => denySet.has(a));
    for (const c of conflicts) {
      results.push({
        category: "Permissions",
        check: "Allow/deny conflict",
        status: "fail",
        message: `${scope} entry "${c}" appears in both allow and deny — behaviour is ambiguous`,
        fix: "Remove the entry from one of the two lists",
      });
    }
  }

  return results;
}
