import type { AuditResult } from "../../types.js";
import { section, type HermesConfig } from "./types.js";

// Prompt-cache TTL — same spirit as the OpenClaw cacheRetention check: without
// an explicit TTL, cache entries expire on the provider default and repeated
// context is re-billed at full input price.
export function auditHermesPromptCaching(config: HermesConfig): AuditResult[] {
  const results: AuditResult[] = [];

  const pc = section(config, "prompt_caching");
  const ttl = pc?.["cache_ttl"];
  if (ttl === undefined || ttl === null || ttl === "") {
    results.push({
      category: "Hermes Caching",
      check: "Prompt cache TTL",
      status: "warn",
      message: "prompt_caching.cache_ttl not set — cache entries expire on the provider default and repeated context is re-billed at full price",
      fix: "Set prompt_caching.cache_ttl in ~/.hermes/config.yaml",
    });
  } else {
    results.push({
      category: "Hermes Caching",
      check: "Prompt cache TTL",
      status: "pass",
      message: `cache_ttl: ${String(ttl)}`,
    });
  }

  return results;
}

export function auditHermesCompression(config: HermesConfig): AuditResult[] {
  const results: AuditResult[] = [];

  const compression = section(config, "compression");
  if (compression?.["enabled"] === true) {
    const threshold = compression["threshold"];
    results.push({
      category: "Hermes Compression",
      check: "Compression enabled",
      status: "pass",
      message: `Context compression enabled${threshold !== undefined && threshold !== null ? ` (threshold: ${String(threshold)})` : ""}`,
    });
  } else {
    results.push({
      category: "Hermes Compression",
      check: "Compression enabled",
      status: "warn",
      message: "compression.enabled is not true — context grows unbounded until the provider hard-limit",
      fix: "Set compression.enabled: true in ~/.hermes/config.yaml",
    });
  }

  return results;
}
