import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join, resolve } from "path";
import type { AuditResult } from "../types.js";
import { expandPath, loadConfig, findWorkspace } from "../utils/config.js";

const SUSPICIOUS_PATTERNS = [
  { pattern: /skillpay/i, label: "SkillPay billing integration" },
  { pattern: /billing\.charge/i, label: "Billing charge call" },
  { pattern: /payment_url/i, label: "Payment URL generation" },
  { pattern: /api\/v1\/billing/i, label: "Billing API endpoint" },
  { pattern: /\.charge\s*\(/i, label: "Charge function call" },
  { pattern: /cryptocurrency|usdt|bitcoin|ethereum/i, label: "Cryptocurrency reference" },
  { pattern: /eval\s*\(/i, label: "eval() usage" },
  { pattern: /child_process.*exec/i, label: "Shell execution" },
  { pattern: /fetch\s*\(\s*['"`]https?:\/\/(?!api\.(openai|anthropic|google))/i, label: "External HTTP call" },
  { pattern: /XMLHttpRequest|urllib\.request/i, label: "HTTP request library" },
];

function scanFile(filePath: string): { pattern: string; line: number; content: string }[] {
  const hits: { pattern: string; line: number; content: string }[] = [];
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    for (const { pattern, label } of SUSPICIOUS_PATTERNS) {
      if (pattern.test(lines[i])) {
        hits.push({
          pattern: label,
          line: i + 1,
          content: lines[i].trim().slice(0, 120),
        });
      }
    }
  }

  return hits;
}

function scanDirectory(dir: string): Map<string, { pattern: string; line: number; content: string }[]> {
  const results = new Map<string, { pattern: string; line: number; content: string }[]>();
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { recursive: true }) as string[];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (!stat.isFile()) continue;
      if (stat.size > 1024 * 1024) continue; // skip files > 1MB

      const ext = fullPath.split(".").pop()?.toLowerCase();
      if (!["js", "ts", "py", "sh", "mjs", "cjs", "json", "md"].includes(ext ?? "")) {
        continue;
      }

      const hits = scanFile(fullPath);
      if (hits.length > 0) {
        results.set(fullPath, hits);
      }
    } catch {
      // skip unreadable files
    }
  }

  return results;
}

export async function runSecurityScan(opts: { config: string; workspace?: string }): Promise<AuditResult[]> {
  const results: AuditResult[] = [];
  const config = loadConfig(opts.config);

  const workspace = opts.workspace ?? (config ? findWorkspace(config) : "~/.openclaw/workspace");
  const skillsDir = resolve(expandPath(workspace), "skills");
  const hooksDir = expandPath("~/.openclaw/hooks");
  const extensionsDir = expandPath("~/.openclaw/extensions");

  const dirs = [
    { path: skillsDir, label: "Skills" },
    { path: hooksDir, label: "Hooks" },
    { path: extensionsDir, label: "Extensions" },
  ];

  for (const { path, label } of dirs) {
    if (!existsSync(path)) {
      results.push({
        category: "Security Scan",
        check: `${label} directory`,
        status: "info",
        message: `${label} directory not found: ${path}`,
      });
      continue;
    }

    const hits = scanDirectory(path);
    if (hits.size === 0) {
      results.push({
        category: "Security Scan",
        check: `${label}: suspicious patterns`,
        status: "pass",
        message: `No suspicious patterns found in ${label.toLowerCase()}`,
      });
    } else {
      for (const [file, fileHits] of hits) {
        const relativePath = file.replace(expandPath("~/"), "~/");
        const patterns = [...new Set(fileHits.map((h) => h.pattern))];
        results.push({
          category: "Security Scan",
          check: `${label}: ${relativePath}`,
          status: "warn",
          message: `${fileHits.length} suspicious pattern(s): ${patterns.join(", ")}`,
          fix: `Review: ${relativePath}`,
        });
      }
    }
  }

  return results;
}
