import { existsSync } from "fs";
import { resolve } from "path";
import { expandPath } from "../utils/config.js";
import type { AuditResult, OpenClawConfig } from "../types.js";

// Embedding providers that need explicit API keys or auth
const PROVIDERS_NEEDING_AUTH: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  voyage: "VOYAGE_API_KEY",
  mistral: "MISTRAL_API_KEY",
  "github-copilot": "COPILOT_GITHUB_TOKEN",
};

// Providers that work without external keys
const LOCAL_PROVIDERS = ["local", "ollama"];

// Default hybrid search weights
const DEFAULT_VECTOR_WEIGHT = 0.7;
const DEFAULT_TEXT_WEIGHT = 0.3;

/**
 * Detect ShieldCortex as a memory provider via hooks, plugins, or load paths.
 * Returns a description string if found, null otherwise.
 */
function detectShieldCortex(config: OpenClawConfig): string | null {
  // Check for cortex-memory hook
  const hookPath = expandPath("~/.openclaw/hooks/cortex-memory");
  if (existsSync(hookPath)) return "cortex-memory hook";

  // Check for shieldcortex-realtime plugin
  const entries = config.plugins?.entries ?? {};
  if (entries["shieldcortex-realtime"]?.enabled !== false) {
    if ("shieldcortex-realtime" in entries) return "shieldcortex-realtime plugin";
  }

  // Check plugin installs
  const installs = config.plugins?.installs ?? {};
  if ("shieldcortex-realtime" in installs) return "shieldcortex-realtime plugin";

  // Check plugin load paths
  const loadPaths = (config.plugins as Record<string, unknown> | undefined)?.load as
    { paths?: string[] } | undefined;
  if (loadPaths?.paths) {
    for (const p of loadPaths.paths) {
      if (p.toLowerCase().includes("shieldcortex")) return `plugin path: ${p.split("/").pop()}`;
    }
  }

  // Check plugins.allow
  const allow = config.plugins?.allow ?? [];
  if (allow.some((a) => a.toLowerCase().includes("shieldcortex"))) return "plugins.allow";

  return null;
}

/**
 * Check dreaming and active-memory plugin status (shared between config/no-config paths).
 */
function checkPluginMemory(config: OpenClawConfig, results: AuditResult[]): void {
  const memoryCore = config.plugins?.entries?.["memory-core"];
  const dreamingConfig = (memoryCore?.config as Record<string, unknown> | undefined)?.dreaming as
    Record<string, unknown> | undefined;

  if (dreamingConfig?.enabled === true) {
    const freq = dreamingConfig.frequency as string | undefined;
    results.push({
      category: "Memory Search",
      check: "Dreaming",
      status: "pass",
      message: `Dreaming enabled${freq ? ` (schedule: ${freq})` : ""} — writes to memory/.dreams/`,
    });
  }

  const activeMemory = config.plugins?.entries?.["active-memory"];
  if (activeMemory?.enabled === true) {
    results.push({
      category: "Memory Search",
      check: "Active Memory plugin",
      status: "pass",
      message: "Active Memory sub-agent enabled — recalls context before each reply",
    });
  } else if (activeMemory?.enabled === false) {
    results.push({
      category: "Memory Search",
      check: "Active Memory plugin",
      status: "info",
      message: "Active Memory plugin present but disabled",
    });
  }
}

export function auditMemorySearch(config: OpenClawConfig): AuditResult[] {
  const results: AuditResult[] = [];
  const defaults = config.agents?.defaults;
  const memorySearch = (defaults as Record<string, unknown> | undefined)?.memorySearch as
    Record<string, unknown> | undefined;

  // --- Memory search enabled check ---

  if (!memorySearch) {
    // Check for ShieldCortex providing memory before saying "no config"
    const shieldcortex = detectShieldCortex(config);
    if (shieldcortex) {
      results.push({
        category: "Memory Search",
        check: "Memory provider",
        status: "pass",
        message: `ShieldCortex detected (${shieldcortex}) — provides persistent memory, semantic search, and recall`,
      });
    } else {
      results.push({
        category: "Memory Search",
        check: "Memory search configured",
        status: "info",
        message: "No memorySearch config — OpenClaw auto-detects an embedding provider at startup",
      });
    }
    // Still check dreaming/active-memory even without memorySearch config
    checkPluginMemory(config, results);
    return results;
  }

  const enabled = memorySearch.enabled;
  if (enabled === false) {
    results.push({
      category: "Memory Search",
      check: "Memory search enabled",
      status: "warn",
      message: "Memory search is explicitly disabled — recall will use FTS-only (no semantic search)",
      fix: "Set agents.defaults.memorySearch.enabled to true, or remove the key to auto-detect",
    });
    return results;
  }

  results.push({
    category: "Memory Search",
    check: "Memory search enabled",
    status: "pass",
    message: "Memory search is enabled",
  });

  // --- Provider check ---

  const provider = memorySearch.provider as string | undefined;
  if (provider) {
    const isLocal = LOCAL_PROVIDERS.includes(provider);
    const envVar = PROVIDERS_NEEDING_AUTH[provider];

    results.push({
      category: "Memory Search",
      check: "Embedding provider",
      status: "pass",
      message: isLocal
        ? `Provider: ${provider} (local — no API key needed)`
        : `Provider: ${provider}`,
    });

    if (envVar && !isLocal) {
      results.push({
        category: "Memory Search",
        check: `Auth: ${provider}`,
        status: "info",
        message: `${provider} requires ${envVar} or matching models.providers entry`,
      });
    }
  }

  // --- Local embedding context size (v2026.4.23 added memorySearch.local.contextSize) ---

  const local = memorySearch.local as Record<string, unknown> | undefined;
  const contextSize = local?.contextSize as number | undefined;
  if (typeof contextSize === "number") {
    if (contextSize < 1024) {
      results.push({
        category: "Memory Search",
        check: "Local embedding context size",
        status: "warn",
        message: `memorySearch.local.contextSize is ${contextSize} — below 1024 truncates most chunks and hurts recall quality. Default is 4096.`,
        fix: "Set agents.defaults.memorySearch.local.contextSize to 4096 (or 2048 on severely constrained hosts).",
      });
    } else if (contextSize > 32768) {
      results.push({
        category: "Memory Search",
        check: "Local embedding context size",
        status: "warn",
        message: `memorySearch.local.contextSize is ${contextSize} — above 32768 bloats embedding-host memory for no recall benefit on typical chunks. Default is 4096.`,
        fix: "Lower agents.defaults.memorySearch.local.contextSize to 4096-16384.",
      });
    } else {
      results.push({
        category: "Memory Search",
        check: "Local embedding context size",
        status: "pass",
        message: `Local embedding contextSize: ${contextSize} tokens (default 4096).`,
      });
    }
  }

  // --- Fallback provider ---

  const fallback = memorySearch.fallback as string | undefined;
  if (!fallback || fallback === "none") {
    results.push({
      category: "Memory Search",
      check: "Embedding fallback",
      status: "info",
      message: "No embedding fallback — if primary provider fails, search degrades to FTS-only",
    });
  } else {
    results.push({
      category: "Memory Search",
      check: "Embedding fallback",
      status: "pass",
      message: `Fallback provider: ${fallback}`,
    });
  }

  // --- Hybrid search config ---

  const query = memorySearch.query as Record<string, unknown> | undefined;
  const hybrid = query?.hybrid as Record<string, unknown> | undefined;

  if (hybrid) {
    const vectorWeight = hybrid.vectorWeight as number | undefined;
    const textWeight = hybrid.textWeight as number | undefined;

    if (vectorWeight != null && textWeight != null) {
      const sum = vectorWeight + textWeight;
      if (Math.abs(sum - 1.0) > 0.01) {
        results.push({
          category: "Memory Search",
          check: "Hybrid search weights",
          status: "warn",
          message: `vectorWeight (${vectorWeight}) + textWeight (${textWeight}) = ${sum} — should sum to 1.0`,
          fix: "Adjust weights to sum to 1.0 (default: 0.7 vector + 0.3 text)",
        });
      } else if (vectorWeight < 0.3) {
        results.push({
          category: "Memory Search",
          check: "Hybrid search weights",
          status: "info",
          message: `Low vector weight (${vectorWeight}) — semantic similarity has less influence than keyword matching`,
        });
      } else {
        results.push({
          category: "Memory Search",
          check: "Hybrid search weights",
          status: "pass",
          message: `Hybrid weights: ${vectorWeight} vector / ${textWeight} text`,
        });
      }
    }

    if (hybrid.enabled === false) {
      results.push({
        category: "Memory Search",
        check: "Hybrid search",
        status: "warn",
        message: "Hybrid search disabled — using vector-only search (misses keyword matches)",
        fix: "Set agents.defaults.memorySearch.query.hybrid.enabled to true",
      });
    }
  }

  // --- Embedding cache ---

  const cache = memorySearch.cache as Record<string, unknown> | undefined;
  if (cache?.enabled === true) {
    const maxEntries = (cache.maxEntries as number) ?? 50000;
    results.push({
      category: "Memory Search",
      check: "Embedding cache",
      status: "pass",
      message: `Embedding cache enabled (max ${maxEntries.toLocaleString()} entries) — saves re-embedding on reindex`,
    });
  } else if (provider && !LOCAL_PROVIDERS.includes(provider)) {
    results.push({
      category: "Memory Search",
      check: "Embedding cache",
      status: "info",
      message: "Embedding cache not enabled — reindexing re-embeds all chunks (costs tokens for cloud providers)",
      fix: "Set agents.defaults.memorySearch.cache.enabled to true",
    });
  }

  // --- SQLite vector acceleration ---

  const store = memorySearch.store as Record<string, unknown> | undefined;
  const vector = store?.vector as Record<string, unknown> | undefined;
  if (vector?.enabled === false) {
    results.push({
      category: "Memory Search",
      check: "Vector acceleration",
      status: "warn",
      message: "sqlite-vec disabled — vector search falls back to slow in-process cosine similarity",
      fix: "Set agents.defaults.memorySearch.store.vector.enabled to true",
    });
  }

  // --- Session memory (experimental) ---

  const experimental = memorySearch.experimental as Record<string, unknown> | undefined;
  if (experimental?.sessionMemory === true) {
    results.push({
      category: "Memory Search",
      check: "Session memory indexing",
      status: "info",
      message: "Experimental session memory enabled — indexes transcripts for recall (results may be stale)",
    });
  }

  // --- Dreaming + Active Memory ---

  checkPluginMemory(config, results);

  // --- ShieldCortex detection (even with explicit memorySearch config) ---

  const shieldcortex = detectShieldCortex(config);
  if (shieldcortex) {
    results.push({
      category: "Memory Search",
      check: "ShieldCortex",
      status: "pass",
      message: `ShieldCortex detected (${shieldcortex}) — persistent memory + semantic search`,
    });
  }

  // --- QMD backend ---

  const memory = (config as Record<string, unknown>).memory as Record<string, unknown> | undefined;
  if (memory?.backend === "qmd") {
    const qmd = memory.qmd as Record<string, unknown> | undefined;
    results.push({
      category: "Memory Search",
      check: "Memory backend",
      status: "pass",
      message: "Using QMD backend for memory search",
    });

    if (qmd) {
      const limits = qmd.limits as Record<string, unknown> | undefined;
      const maxResults = (limits?.maxResults as number) ?? 6;
      if (maxResults > 12) {
        results.push({
          category: "Memory Search",
          check: "QMD max results",
          status: "warn",
          message: `QMD maxResults is ${maxResults} — injecting too many memories burns context tokens`,
          fix: "Set memory.qmd.limits.maxResults to 6-10",
        });
      }

      const update = qmd.update as Record<string, unknown> | undefined;
      if (update?.waitForBootSync === true) {
        results.push({
          category: "Memory Search",
          check: "QMD boot sync",
          status: "info",
          message: "waitForBootSync enabled — gateway startup blocks until memory index is ready",
        });
      }
    }
  }

  return results;
}
