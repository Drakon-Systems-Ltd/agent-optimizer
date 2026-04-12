import type { AuditResult, OpenClawConfig } from "../types.js";
import { loadAuthProfiles, expandPath } from "../utils/config.js";

export function auditAuthProfiles(
  config: OpenClawConfig,
  agentDir: string
): AuditResult[] {
  const results: AuditResult[] = [];
  const profiles = loadAuthProfiles(agentDir);

  if (!profiles) {
    results.push({
      category: "Auth",
      check: "Auth profiles exist",
      status: "fail",
      message: `No auth-profiles.json found in ${agentDir}`,
      fix: "Run: openclaw configure --section model",
    });
    return results;
  }

  const entries = Object.entries(profiles.profiles ?? {});
  if (entries.length === 0) {
    results.push({
      category: "Auth",
      check: "Auth profiles configured",
      status: "fail",
      message: "No auth profiles configured",
      fix: "Run: openclaw configure --section model",
    });
    return results;
  }

  // Check for expired OAuth tokens
  const now = Date.now();
  for (const [name, profile] of entries) {
    if (profile.expires) {
      const remaining = profile.expires - now;
      if (remaining < 0) {
        results.push({
          category: "Auth",
          check: `Token expiry: ${name}`,
          status: "fail",
          message: `OAuth token expired ${Math.abs(Math.round(remaining / 3600000))}h ago`,
          fix: `Re-authenticate: openclaw models auth login --provider ${profile.provider}`,
        });
      } else if (remaining < 3600000) {
        results.push({
          category: "Auth",
          check: `Token expiry: ${name}`,
          status: "warn",
          message: `OAuth token expires in ${Math.round(remaining / 60000)}m`,
        });
      } else {
        results.push({
          category: "Auth",
          check: `Token expiry: ${name}`,
          status: "pass",
          message: `Valid for ${Math.round(remaining / 3600000)}h`,
        });
      }
    }
  }

  // Check for duplicate keys across profiles
  const keyMap = new Map<string, string[]>();
  for (const [name, profile] of entries) {
    const key = profile.token ?? profile.key ?? "";
    if (key && key.length > 20) {
      const short = key.slice(0, 15);
      if (!keyMap.has(short)) keyMap.set(short, []);
      keyMap.get(short)!.push(name);
    }
  }
  for (const [, names] of keyMap) {
    if (names.length > 1) {
      results.push({
        category: "Auth",
        check: "Duplicate API keys",
        status: "info",
        message: `Profiles share the same key: ${names.join(", ")}`,
      });
    }
  }

  // Check primary model has auth
  const primary = config.agents?.defaults?.model?.primary;
  if (primary) {
    const provider = primary.split("/")[0];
    const hasAuth = entries.some(([, p]) => p.provider === provider);
    if (!hasAuth && provider !== "ollama") {
      results.push({
        category: "Auth",
        check: `Auth for primary model (${provider})`,
        status: "fail",
        message: `No auth profile for provider "${provider}" used by primary model`,
        fix: `Add auth: openclaw models auth login --provider ${provider}`,
      });
    }
  }

  return results;
}
