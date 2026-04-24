import { describe, it, expect } from "vitest";
import { auditMemorySearch } from "../src/auditors/memory-search.js";
import type { OpenClawConfig } from "../src/types.js";

describe("auditMemorySearch", () => {
  it("detects ShieldCortex or reports no config when no memorySearch", () => {
    const config: OpenClawConfig = { agents: { defaults: {} } };
    const results = auditMemorySearch(config);
    // Either ShieldCortex detected (pass) or no config (info) depending on host
    const first = results[0];
    expect(["pass", "info"]).toContain(first.status);
    if (first.status === "pass") {
      expect(first.message).toContain("ShieldCortex");
    } else {
      expect(first.message).toContain("auto-detects");
    }
  });

  it("warns when memory search is explicitly disabled", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { memorySearch: { enabled: false } } as any },
    };
    const results = auditMemorySearch(config);
    expect(results.some((r) => r.status === "warn" && r.message.includes("disabled"))).toBe(true);
  });

  it("reports provider and fallback status", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          memorySearch: { provider: "openai", fallback: "local" },
        } as any,
      },
    };
    const results = auditMemorySearch(config);
    expect(results.some((r) => r.check === "Embedding provider" && r.status === "pass")).toBe(true);
    expect(results.some((r) => r.check === "Embedding fallback" && r.status === "pass")).toBe(true);
    expect(results.some((r) => r.check === "Auth: openai")).toBe(true);
  });

  it("reports local provider needs no auth", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          memorySearch: { provider: "local" },
        } as any,
      },
    };
    const results = auditMemorySearch(config);
    const providerResult = results.find((r) => r.check === "Embedding provider");
    expect(providerResult?.message).toContain("no API key");
  });

  it("warns on bad hybrid search weights", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          memorySearch: {
            query: { hybrid: { vectorWeight: 0.8, textWeight: 0.5 } },
          },
        } as any,
      },
    };
    const results = auditMemorySearch(config);
    expect(results.some((r) => r.status === "warn" && r.message.includes("should sum to 1.0"))).toBe(true);
  });

  it("passes on correct hybrid search weights", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          memorySearch: {
            query: { hybrid: { vectorWeight: 0.7, textWeight: 0.3 } },
          },
        } as any,
      },
    };
    const results = auditMemorySearch(config);
    expect(results.some((r) => r.check === "Hybrid search weights" && r.status === "pass")).toBe(true);
  });

  it("warns when hybrid search is disabled", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          memorySearch: {
            query: { hybrid: { enabled: false } },
          },
        } as any,
      },
    };
    const results = auditMemorySearch(config);
    expect(results.some((r) => r.status === "warn" && r.message.includes("vector-only"))).toBe(true);
  });

  it("reports embedding cache status", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          memorySearch: { provider: "openai", cache: { enabled: true, maxEntries: 100000 } },
        } as any,
      },
    };
    const results = auditMemorySearch(config);
    expect(results.some((r) => r.check === "Embedding cache" && r.status === "pass")).toBe(true);
  });

  it("suggests cache for cloud providers", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          memorySearch: { provider: "openai" },
        } as any,
      },
    };
    const results = auditMemorySearch(config);
    expect(results.some((r) => r.check === "Embedding cache" && r.status === "info")).toBe(true);
  });

  it("warns when sqlite-vec is disabled", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          memorySearch: { store: { vector: { enabled: false } } },
        } as any,
      },
    };
    const results = auditMemorySearch(config);
    expect(results.some((r) => r.status === "warn" && r.message.includes("sqlite-vec"))).toBe(true);
  });

  it("detects dreaming config in plugins", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { memorySearch: {} } as any },
      plugins: {
        entries: {
          "memory-core": { enabled: true, config: { dreaming: { enabled: true, frequency: "0 3 * * *" } } },
        },
      },
    };
    const results = auditMemorySearch(config);
    expect(results.some((r) => r.check === "Dreaming" && r.status === "pass")).toBe(true);
  });

  it("detects active memory plugin", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { memorySearch: {} } as any },
      plugins: {
        entries: {
          "active-memory": { enabled: true },
        },
      },
    };
    const results = auditMemorySearch(config);
    expect(results.some((r) => r.check === "Active Memory plugin" && r.status === "pass")).toBe(true);
  });

  it("warns when local.contextSize is too small (<1024)", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          memorySearch: { provider: "local", local: { contextSize: 512 } },
        } as any,
      },
    };
    const results = auditMemorySearch(config);
    expect(
      results.some(
        (r) => r.check === "Local embedding context size" && r.status === "warn"
      )
    ).toBe(true);
  });

  it("warns when local.contextSize is too large (>32768)", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          memorySearch: { provider: "local", local: { contextSize: 65536 } },
        } as any,
      },
    };
    const results = auditMemorySearch(config);
    expect(
      results.some(
        (r) => r.check === "Local embedding context size" && r.status === "warn"
      )
    ).toBe(true);
  });

  it("passes when local.contextSize is in a sensible range", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          memorySearch: { provider: "local", local: { contextSize: 4096 } },
        } as any,
      },
    };
    const results = auditMemorySearch(config);
    expect(
      results.some(
        (r) => r.check === "Local embedding context size" && r.status === "pass"
      )
    ).toBe(true);
  });

  it("does not emit local.contextSize check when field is unset", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          memorySearch: { provider: "local" },
        } as any,
      },
    };
    const results = auditMemorySearch(config);
    expect(
      results.some((r) => r.check === "Local embedding context size")
    ).toBe(false);
  });

  it("detects QMD backend with high maxResults", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { memorySearch: {} } as any },
      memory: { backend: "qmd", qmd: { limits: { maxResults: 20 } } },
    } as any;
    const results = auditMemorySearch(config);
    expect(results.some((r) => r.check === "QMD max results" && r.status === "warn")).toBe(true);
  });
});
