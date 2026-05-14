import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join, resolve, basename, dirname } from "path";
import chalk from "chalk";
import type { AuditResult } from "../../types.js";
import { expandPath, loadConfig, findWorkspace } from "../../utils/config.js";

// --- Pattern definitions ---

interface PatternDef {
  pattern: RegExp;
  label: string;
  severity: "high" | "medium" | "low";
  category: "billing" | "injection" | "exfiltration" | "obfuscation" | "permissions";
}

const SUSPICIOUS_PATTERNS: PatternDef[] = [
  // Billing / payment
  { pattern: /skillpay/i, label: "SkillPay billing integration", severity: "high", category: "billing" },
  { pattern: /billing[._]charge/i, label: "Billing charge call", severity: "high", category: "billing" },
  { pattern: /payment_url|payment.link|paymentIntent/i, label: "Payment URL/intent generation", severity: "high", category: "billing" },
  { pattern: /api\/v1\/billing|\/billing\/charge/i, label: "Billing API endpoint", severity: "high", category: "billing" },
  { pattern: /\.charge\s*\(/i, label: "Charge function call", severity: "high", category: "billing" },
  { pattern: /stripe\.com|stripe\.checkout/i, label: "Stripe payment integration", severity: "medium", category: "billing" },
  { pattern: /cryptocurrency|usdt|bitcoin|ethereum|web3|0x[a-fA-F0-9]{40}/i, label: "Cryptocurrency/wallet reference", severity: "high", category: "billing" },
  { pattern: /gumroad|lemonSqueezy|paddle\.com|buymeacoffee/i, label: "Payment platform integration", severity: "medium", category: "billing" },

  // Code injection
  { pattern: /eval\s*\(/, label: "eval() usage", severity: "high", category: "injection" },
  { pattern: /new\s+Function\s*\(/, label: "Dynamic function constructor", severity: "high", category: "injection" },
  { pattern: /child_process/, label: "child_process module", severity: "medium", category: "injection" },
  { pattern: /exec\s*\(\s*['"`]/, label: "Shell command execution with string", severity: "high", category: "injection" },
  { pattern: /execSync\s*\(/, label: "Synchronous shell execution", severity: "medium", category: "injection" },
  { pattern: /spawn\s*\(\s*['"`](?!node|npm|npx|python|pip)/, label: "Process spawn (non-standard binary)", severity: "medium", category: "injection" },
  { pattern: /\.replace\s*\(.*\bFunction\b/, label: "String-to-function conversion", severity: "high", category: "injection" },
  { pattern: /vm\.runIn(New|This)Context/i, label: "VM context execution", severity: "high", category: "injection" },

  // Data exfiltration / network
  { pattern: /fetch\s*\(\s*['"`]https?:\/\/(?!api\.(openai|anthropic|google|x\.ai|deepseek|openrouter))/i, label: "HTTP call to non-standard endpoint", severity: "medium", category: "exfiltration" },
  { pattern: /XMLHttpRequest/i, label: "XMLHttpRequest usage", severity: "medium", category: "exfiltration" },
  { pattern: /urllib\.request|requests\.post|requests\.get/i, label: "Python HTTP library", severity: "low", category: "exfiltration" },
  { pattern: /axios\s*\.\s*(get|post|put|delete)\s*\(/i, label: "Axios HTTP call", severity: "low", category: "exfiltration" },
  { pattern: /webhook|ngrok|localtunnel|serveo/i, label: "Tunnel/webhook service", severity: "medium", category: "exfiltration" },
  { pattern: /telemetry|analytics|tracking|mixpanel|segment\.io|posthog/i, label: "Telemetry/analytics", severity: "medium", category: "exfiltration" },
  { pattern: /navigator\.sendBeacon/i, label: "Beacon API (silent data send)", severity: "high", category: "exfiltration" },

  // Obfuscation
  { pattern: /atob\s*\(|btoa\s*\(|Buffer\.from\s*\(\s*['"][A-Za-z0-9+/=]{50,}/, label: "Base64 encode/decode (long string)", severity: "medium", category: "obfuscation" },
  { pattern: /\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){10,}/, label: "Hex-encoded string sequence", severity: "high", category: "obfuscation" },
  { pattern: /\\u[0-9a-fA-F]{4}(?:\\u[0-9a-fA-F]{4}){10,}/, label: "Unicode-encoded string sequence", severity: "high", category: "obfuscation" },
  { pattern: /String\.fromCharCode\s*\(/, label: "String.fromCharCode (potential obfuscation)", severity: "medium", category: "obfuscation" },
  { pattern: /\['\\x/, label: "Property access via hex escape", severity: "high", category: "obfuscation" },
];

// Known malicious or risky npm packages
const RISKY_PACKAGES = [
  "event-stream", "flatmap-stream", "ua-parser-js", "coa", "rc",
  "colors", "faker", "node-ipc", "peacenotwar", "is-promise",
  "lodash.template", // when used for injection
];

// --- Scanning functions ---

interface FileHit {
  pattern: string;
  severity: "high" | "medium" | "low";
  category: string;
  line: number;
  content: string;
}

interface SkillReport {
  name: string;
  path: string;
  source: "clawhub" | "local" | "unknown";
  files: number;
  hits: FileHit[];
  urls: string[];
  dependencies: string[];
  riskyDeps: string[];
  executableFiles: string[];
  score: "clean" | "info" | "suspicious" | "dangerous";
  scoreReason: string;
}

function extractUrls(content: string): string[] {
  const urlRegex = /https?:\/\/[^\s"'`<>)\]},]+/g;
  const matches = content.match(urlRegex) ?? [];
  // Deduplicate and filter out common safe domains
  const safe = ["github.com", "npmjs.com", "docs.openclaw.ai", "nodejs.org", "developer.mozilla.org", "json-schema.org"];
  return [...new Set(matches)].filter((u) => !safe.some((s) => u.includes(s)));
}

function scanFileDetailed(filePath: string): { hits: FileHit[]; urls: string[] } {
  const hits: FileHit[] = [];
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    for (const def of SUSPICIOUS_PATTERNS) {
      if (def.pattern.test(lines[i])) {
        hits.push({
          pattern: def.label,
          severity: def.severity,
          category: def.category,
          line: i + 1,
          content: lines[i].trim().slice(0, 120),
        });
      }
    }
  }

  const urls = extractUrls(content);
  return { hits, urls };
}

function checkDependencies(dir: string): { deps: string[]; risky: string[] } {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return { deps: [], risky: [] };

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const allDeps = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    const risky = allDeps.filter((d) => RISKY_PACKAGES.includes(d));
    return { deps: allDeps, risky };
  } catch {
    return { deps: [], risky: [] };
  }
}

function checkProvenance(dir: string): "clawhub" | "local" | "unknown" {
  const originPath = join(dir, ".clawhub", "origin.json");
  if (existsSync(originPath)) return "clawhub";
  const metaPath = join(dir, "_meta.json");
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      if (meta.source === "clawhub" || meta.clawHubId) return "clawhub";
    } catch { /* ignore */ }
  }
  return "local";
}

function findExecutableFiles(dir: string): string[] {
  const executables: string[] = [];
  if (!existsSync(dir)) return executables;

  const entries = readdirSync(dir, { recursive: true }) as string[];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (!stat.isFile()) continue;
      // Check if file has execute permission (unix)
      if (stat.mode & 0o111) {
        const ext = fullPath.split(".").pop()?.toLowerCase();
        // Exclude obvious script interpreters
        if (!["md", "json", "txt", "yml", "yaml", "toml"].includes(ext ?? "")) {
          executables.push(entry);
        }
      }
    } catch { /* skip */ }
  }
  return executables;
}

function scoreSkill(report: SkillReport): { score: SkillReport["score"]; reason: string } {
  const highHits = report.hits.filter((h) => h.severity === "high").length;
  const medHits = report.hits.filter((h) => h.severity === "medium").length;
  const hasBilling = report.hits.some((h) => h.category === "billing");
  const hasInjection = report.hits.some((h) => h.category === "injection" && h.severity === "high");
  const hasObfuscation = report.hits.some((h) => h.category === "obfuscation" && h.severity === "high");

  if (hasBilling || (hasInjection && hasObfuscation)) {
    return { score: "dangerous", reason: hasBilling ? "Hidden billing detected" : "Injection + obfuscation" };
  }
  if (highHits >= 2 || report.riskyDeps.length > 0) {
    return { score: "suspicious", reason: `${highHits} high-severity patterns${report.riskyDeps.length ? `, risky deps: ${report.riskyDeps.join(", ")}` : ""}` };
  }
  if (highHits >= 1 || medHits >= 3) {
    return { score: "suspicious", reason: `${highHits} high + ${medHits} medium severity patterns` };
  }
  if (medHits >= 1 || report.urls.length > 5) {
    return { score: "info", reason: medHits ? `${medHits} medium-severity patterns` : `${report.urls.length} external URLs` };
  }
  return { score: "clean", reason: "No suspicious patterns detected" };
}

function scanSkillDirectory(skillDir: string): SkillReport {
  const name = basename(skillDir);
  const source = checkProvenance(skillDir);
  const { deps, risky } = checkDependencies(skillDir);
  const executables = findExecutableFiles(skillDir);

  const allHits: FileHit[] = [];
  const allUrls: string[] = [];
  let fileCount = 0;

  const entries = readdirSync(skillDir, { recursive: true }) as string[];
  for (const entry of entries) {
    const fullPath = join(skillDir, entry);
    try {
      const stat = statSync(fullPath);
      if (!stat.isFile()) continue;
      if (stat.size > 1024 * 1024) continue;

      const ext = fullPath.split(".").pop()?.toLowerCase();
      if (!["js", "ts", "py", "sh", "mjs", "cjs", "json", "md"].includes(ext ?? "")) continue;

      fileCount++;
      const { hits, urls } = scanFileDetailed(fullPath);
      allHits.push(...hits);
      allUrls.push(...urls);
    } catch { /* skip */ }
  }

  const report: SkillReport = {
    name,
    path: skillDir,
    source,
    files: fileCount,
    hits: allHits,
    urls: [...new Set(allUrls)],
    dependencies: deps,
    riskyDeps: risky,
    executableFiles: executables,
    score: "clean",
    scoreReason: "",
  };

  const { score, reason } = scoreSkill(report);
  report.score = score;
  report.scoreReason = reason;

  return report;
}

// --- Main scan function ---

export async function runSecurityScan(opts: { config: string; workspace?: string }): Promise<AuditResult[]> {
  const results: AuditResult[] = [];
  const config = loadConfig(opts.config);

  const workspace = opts.workspace ?? (config ? findWorkspace(config) : "~/.openclaw/workspace");
  const skillsDir = resolve(expandPath(workspace), "skills");
  const hooksDir = expandPath("~/.openclaw/hooks");
  const extensionsDir = expandPath("~/.openclaw/extensions");

  const scanTargets = [
    { path: skillsDir, label: "Skills", perItem: true },
    { path: hooksDir, label: "Hooks", perItem: true },
    { path: extensionsDir, label: "Extensions", perItem: true },
  ];

  let totalSkills = 0;
  let cleanCount = 0;
  let infoCount = 0;
  let suspiciousCount = 0;
  let dangerousCount = 0;

  for (const { path, label, perItem } of scanTargets) {
    if (!existsSync(path)) {
      results.push({
        category: "Security Scan",
        check: `${label} directory`,
        status: "info",
        message: `${label} directory not found: ${path.replace(expandPath("~/"), "~/")}`,
      });
      continue;
    }

    if (perItem) {
      // Scan each subdirectory as a separate skill/hook/extension
      const subdirs = readdirSync(path).filter((d) => {
        try { return statSync(join(path, d)).isDirectory(); } catch { return false; }
      });

      if (subdirs.length === 0) {
        results.push({
          category: "Security Scan",
          check: `${label}`,
          status: "pass",
          message: `No ${label.toLowerCase()} installed`,
        });
        continue;
      }

      for (const subdir of subdirs) {
        const fullPath = join(path, subdir);
        const report = scanSkillDirectory(fullPath);
        totalSkills++;

        const SCORE_ICONS: Record<string, string> = {
          clean: chalk.green("✓"),
          info: chalk.blue("ℹ"),
          suspicious: chalk.yellow("⚠"),
          dangerous: chalk.red("✗"),
        };

        const STATUS_MAP: Record<string, AuditResult["status"]> = {
          clean: "pass",
          info: "info",
          suspicious: "warn",
          dangerous: "fail",
        };

        const provenance = report.source === "clawhub" ? " [ClawHub]" : report.source === "local" ? " [local]" : "";

        // Main score result
        results.push({
          category: `${label} Scan`,
          check: `${report.name}${provenance}`,
          status: STATUS_MAP[report.score],
          message: `${report.scoreReason} (${report.files} files scanned)`,
          fix: report.score === "dangerous"
            ? `REMOVE immediately: rm -rf ${fullPath.replace(expandPath("~/"), "~/")}`
            : report.score === "suspicious"
              ? `Review manually: ${fullPath.replace(expandPath("~/"), "~/")}`
              : undefined,
        });

        // Detail: risky dependencies
        if (report.riskyDeps.length > 0) {
          results.push({
            category: `${label} Scan`,
            check: `${report.name}: risky dependencies`,
            status: "fail",
            message: `Known risky packages: ${report.riskyDeps.join(", ")}`,
            fix: "Remove or replace these dependencies",
          });
        }

        // Detail: executable files
        if (report.executableFiles.length > 0) {
          results.push({
            category: `${label} Scan`,
            check: `${report.name}: executable files`,
            status: "warn",
            message: `${report.executableFiles.length} executable file(s): ${report.executableFiles.slice(0, 5).join(", ")}${report.executableFiles.length > 5 ? ` +${report.executableFiles.length - 5} more` : ""}`,
            fix: "Review why these files have execute permissions",
          });
        }

        // Detail: external URLs
        if (report.urls.length > 0) {
          results.push({
            category: `${label} Scan`,
            check: `${report.name}: external URLs`,
            status: report.urls.length > 5 ? "warn" : "info",
            message: `${report.urls.length} external URL(s): ${report.urls.slice(0, 3).join(", ")}${report.urls.length > 3 ? ` +${report.urls.length - 3} more` : ""}`,
          });
        }

        // Detail: high-severity hits
        const highHits = report.hits.filter((h) => h.severity === "high");
        if (highHits.length > 0) {
          const uniquePatterns = [...new Set(highHits.map((h) => h.pattern))];
          results.push({
            category: `${label} Scan`,
            check: `${report.name}: high-severity patterns`,
            status: "fail",
            message: uniquePatterns.join(", "),
            fix: `Review: ${fullPath.replace(expandPath("~/"), "~/")}`,
          });
        }

        // Count for summary
        if (report.score === "clean") cleanCount++;
        else if (report.score === "info") infoCount++;
        else if (report.score === "suspicious") suspiciousCount++;
        else if (report.score === "dangerous") dangerousCount++;
      }
    }
  }

  // Summary
  if (totalSkills > 0) {
    results.push({
      category: "Security Summary",
      check: "Scan complete",
      status: dangerousCount > 0 ? "fail" : suspiciousCount > 0 ? "warn" : "pass",
      message: `${totalSkills} scanned: ${cleanCount} clean, ${infoCount} info, ${suspiciousCount} suspicious, ${dangerousCount} dangerous`,
    });
  }

  return results;
}
