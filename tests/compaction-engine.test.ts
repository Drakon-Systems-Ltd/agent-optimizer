import { describe, it, expect } from "vitest";
import { auditCompactionEngine } from "../src/auditors/openclaw/compaction-engine.js";
import type { OpenClawConfig } from "../src/types.js";

describe("auditCompactionEngine", () => {
  it("returns empty for an empty config", () => {
    expect(auditCompactionEngine({})).toHaveLength(0);
  });

  it("flags defaults.compaction.provider lossless-claw as info", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { compaction: { provider: "lossless-claw" } } },
    };
    const results = auditCompactionEngine(config);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("info");
    expect(results[0].check).toBe("Legacy compaction provider");
    expect(results[0].category).toBe("Compaction");
  });

  it("does not flag a non-lossless-claw provider value", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { compaction: { provider: "some-other-engine" } } },
    };
    expect(auditCompactionEngine(config)).toHaveLength(0);
  });

  it("flags a per-agent compaction.provider lossless-claw mentioning the agent", () => {
    const config = {
      agents: {
        list: [
          { id: "researcher", name: "Researcher", workspace: "/w", agentDir: "/d", compaction: { provider: "lossless-claw" } },
        ],
      },
    } as unknown as OpenClawConfig;
    const results = auditCompactionEngine(config);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("info");
    expect(results[0].check).toContain("researcher");
    expect(results[0].message).toContain("researcher");
  });

  it("flags both defaults and an offending agent (2 infos)", () => {
    const config = {
      agents: {
        defaults: { compaction: { provider: "lossless-claw" } },
        list: [
          { id: "a1", name: "A1", workspace: "/w", agentDir: "/d", compaction: { provider: "lossless-claw" } },
        ],
      },
    } as unknown as OpenClawConfig;
    const results = auditCompactionEngine(config);
    expect(results).toHaveLength(2);
    expect(results.every(r => r.status === "info")).toBe(true);
  });

  it("warns (refuse auto-fix) when contextEngine is a different value", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { compaction: { provider: "lossless-claw" } } },
      plugins: { slots: { contextEngine: "other-engine" } },
    };
    const results = auditCompactionEngine(config);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("warn");
    expect(results[0].message).toContain("REFUSE");
  });

  it("stays info when contextEngine already equals lossless-claw", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { compaction: { provider: "lossless-claw" } } },
      plugins: { slots: { contextEngine: "lossless-claw" } },
    };
    const results = auditCompactionEngine(config);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("info");
  });

  it("returns empty when compaction is present but has no provider field", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { compaction: { mode: "summary", model: "x/y" } } },
    };
    expect(auditCompactionEngine(config)).toHaveLength(0);
  });

  it("returns empty when an agent has compaction but no provider", () => {
    const config = {
      agents: {
        list: [
          { id: "a1", name: "A1", workspace: "/w", agentDir: "/d", compaction: { mode: "summary" } },
        ],
      },
    } as unknown as OpenClawConfig;
    expect(auditCompactionEngine(config)).toHaveLength(0);
  });
});
