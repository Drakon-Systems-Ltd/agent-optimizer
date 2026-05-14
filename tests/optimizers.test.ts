import { describe, it, expect } from "vitest";
import type { OpenClawConfig } from "../src/types.js";
import { getOptimizations, OPTIMIZATION_TAGS } from "../src/optimizers/index.js";

// ── Back-compat: existing 5 dimensions still behave correctly ──────
describe("getOptimizations — back-compat (existing 5 dimensions)", () => {
  it("context: triggers when above target on aggressive", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { contextTokens: 1_000_000 } },
    };
    const opts = getOptimizations(config, "aggressive");
    const ctx = opts.find((o) => o.tag === "context");
    expect(ctx?.recommended).toBe(100000);
    expect(ctx?.current).toBe(1_000_000);
  });

  it("heartbeat: triggers when current differs from target", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { heartbeat: { every: "1h" } } },
    };
    const opts = getOptimizations(config, "balanced");
    expect(opts.find((o) => o.tag === "heartbeat")?.recommended).toBe("6h");
  });

  it("subagents: triggers when count exceeds target", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { subagents: { maxConcurrent: 10 } } },
    };
    expect(
      getOptimizations(config, "aggressive").find((o) => o.tag === "subagents")
        ?.recommended
    ).toBe(2);
  });

  it("compaction: triggers when mode is unset", () => {
    const config: OpenClawConfig = { agents: { defaults: {} } };
    expect(
      getOptimizations(config, "balanced").find((o) => o.tag === "compaction")
    ).toBeDefined();
  });

  it("pruning: triggers when contextPruning.mode is unset", () => {
    const config: OpenClawConfig = { agents: { defaults: {} } };
    expect(
      getOptimizations(config, "balanced").find((o) => o.tag === "pruning")
    ).toBeDefined();
  });
});

// ── New dimensions ─────────────────────────────────────────────────
describe("getOptimizations — image-max-dim", () => {
  it("suggests shrinking when above aggressive target", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { imageMaxDimensionPx: 1500 } as never },
    };
    const opts = getOptimizations(config, "aggressive");
    const img = opts.find((o) => o.tag === "image-max-dim");
    expect(img).toBeDefined();
    expect(img?.recommended).toBe(800);
  });

  it("no-op when at or below target", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { imageMaxDimensionPx: 800 } as never },
    };
    expect(
      getOptimizations(config, "aggressive").find((o) => o.tag === "image-max-dim")
    ).toBeUndefined();
  });

  it("suggests cap on balanced when unset (enforces budget)", () => {
    const config: OpenClawConfig = { agents: { defaults: {} } };
    expect(
      getOptimizations(config, "balanced").find((o) => o.tag === "image-max-dim")
        ?.recommended
    ).toBe(1200);
  });

  it("does NOT suggest a cap on minimal when unset", () => {
    const config: OpenClawConfig = { agents: { defaults: {} } };
    expect(
      getOptimizations(config, "minimal").find((o) => o.tag === "image-max-dim")
    ).toBeUndefined();
  });
});

describe("getOptimizations — bootstrap budgets", () => {
  it("bootstrap-max-chars: enforces budget on balanced", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { bootstrapMaxChars: 50_000 } as never },
    };
    expect(
      getOptimizations(config, "balanced").find((o) => o.tag === "bootstrap-max-chars")
        ?.recommended
    ).toBe(20_000);
  });

  it("bootstrap-max-chars: no-op when below target", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { bootstrapMaxChars: 5_000 } as never },
    };
    expect(
      getOptimizations(config, "aggressive").find((o) => o.tag === "bootstrap-max-chars")
    ).toBeUndefined();
  });

  it("bootstrap-total-max-chars: enforces budget on aggressive", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { bootstrapTotalMaxChars: 500_000 } as never },
    };
    expect(
      getOptimizations(config, "aggressive").find((o) => o.tag === "bootstrap-total-max-chars")
        ?.recommended
    ).toBe(100_000);
  });
});

describe("getOptimizations — isolated-cron", () => {
  it("only suggested on aggressive when currently false/unset", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { heartbeat: { every: "12h" } } },
    };
    expect(
      getOptimizations(config, "minimal").find((o) => o.tag === "isolated-cron")
    ).toBeUndefined();
    expect(
      getOptimizations(config, "balanced").find((o) => o.tag === "isolated-cron")
    ).toBeUndefined();
    expect(
      getOptimizations(config, "aggressive").find((o) => o.tag === "isolated-cron")
        ?.recommended
    ).toBe(true);
  });

  it("no-op when already true", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: { heartbeat: { every: "12h", isolatedSession: true } as never },
      },
    };
    expect(
      getOptimizations(config, "aggressive").find((o) => o.tag === "isolated-cron")
    ).toBeUndefined();
  });
});

describe("getOptimizations — cache-ttl-pruning", () => {
  it("only suggested on balanced/aggressive when unset", () => {
    const config: OpenClawConfig = { agents: { defaults: {} } };
    expect(
      getOptimizations(config, "minimal").find((o) => o.tag === "cache-ttl-pruning")
    ).toBeUndefined();
    expect(
      getOptimizations(config, "balanced").find((o) => o.tag === "cache-ttl-pruning")
    ).toBeDefined();
    expect(
      getOptimizations(config, "aggressive").find((o) => o.tag === "cache-ttl-pruning")
        ?.recommended
    ).toBe("cache-ttl");
  });

  it("skipped when contextPruning.mode is already explicitly set", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { contextPruning: { mode: "lru" } } },
    };
    expect(
      getOptimizations(config, "balanced").find((o) => o.tag === "cache-ttl-pruning")
    ).toBeUndefined();
  });
});

describe("getOptimizations — fallback-chain (info-only)", () => {
  it("info-only when below target count", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: { primary: "anthropic/sonnet", fallbacks: ["openai/gpt"] },
        },
      },
    };
    const fb = getOptimizations(config, "aggressive").find(
      (o) => o.tag === "fallback-chain"
    );
    expect(fb?.info).toBe(true);
    expect(Array.isArray(fb?.recommended)).toBe(true);
    expect((fb?.recommended as unknown[]).length).toBeGreaterThanOrEqual(3);
  });

  it("no-op when chain already meets target", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: "anthropic/sonnet",
            fallbacks: ["openai/gpt", "google/gemini", "deepseek/v3"],
          },
        },
      },
    };
    expect(
      getOptimizations(config, "aggressive").find((o) => o.tag === "fallback-chain")
    ).toBeUndefined();
  });
});

describe("getOptimizations — per-channel dimensions", () => {
  it("history-limit: one optimization per offending channel", () => {
    const config: OpenClawConfig = {
      channels: {
        discord: { historyLimit: 200 },
        slack: { historyLimit: 30 },
        telegram: { historyLimit: 100 },
      },
    };
    const opts = getOptimizations(config, "aggressive");
    const histOpts = opts.filter((o) => o.tag === "channel-history-limit");
    expect(histOpts.length).toBe(3); // all 3 exceed 20
    expect(
      histOpts.find((o) => o.path === "channels.slack.historyLimit")
    ).toBeDefined();
  });

  it.each([
    ["discord", "channel-history-limit", "historyLimit", 200],
    ["slack", "channel-media-max", "mediaMaxMb", 50],
    ["telegram", "channel-text-chunk", "textChunkLimit", 8000],
    ["whatsapp", "channel-history-limit", "historyLimit", 75],
  ] as const)(
    "%s/%s: triggers when %s exceeds aggressive target",
    (provider, tag, key, value) => {
      const config: OpenClawConfig = {
        channels: { [provider]: { [key]: value } },
      };
      const opts = getOptimizations(config, "aggressive");
      const match = opts.find(
        (o) => o.tag === tag && o.path === `channels.${provider}.${key}`
      );
      expect(match).toBeDefined();
    }
  );

  it("does not iterate non-object channel entries", () => {
    const config: OpenClawConfig = {
      channels: { malformed: "not an object" as never, discord: { historyLimit: 200 } },
    };
    const opts = getOptimizations(config, "aggressive");
    const histOpts = opts.filter((o) => o.tag === "channel-history-limit");
    expect(histOpts.length).toBe(1);
    expect(histOpts[0]?.path).toBe("channels.discord.historyLimit");
  });
});

describe("getOptimizations — discord-idle-hours", () => {
  it("skipped when discord not configured", () => {
    const config: OpenClawConfig = { channels: { slack: {} } };
    expect(
      getOptimizations(config, "aggressive").find((o) => o.tag === "discord-idle-hours")
    ).toBeUndefined();
  });

  it("skipped when threadBindings is missing", () => {
    const config: OpenClawConfig = { channels: { discord: {} } };
    expect(
      getOptimizations(config, "aggressive").find((o) => o.tag === "discord-idle-hours")
    ).toBeUndefined();
  });

  it("suggests when idleHours exceeds target", () => {
    const config: OpenClawConfig = {
      channels: { discord: { threadBindings: { idleHours: 72 } } },
    };
    expect(
      getOptimizations(config, "aggressive").find((o) => o.tag === "discord-idle-hours")
        ?.recommended
    ).toBe(8);
  });

  it("no-op when within target", () => {
    const config: OpenClawConfig = {
      channels: { discord: { threadBindings: { idleHours: 4 } } },
    };
    expect(
      getOptimizations(config, "aggressive").find((o) => o.tag === "discord-idle-hours")
    ).toBeUndefined();
  });
});

describe("getOptimizations — channel-model-routing", () => {
  it("aggressive-only info entry when modelByChannel empty", () => {
    const config: OpenClawConfig = { channels: { discord: {}, slack: {} } };
    const opts = getOptimizations(config, "aggressive");
    const route = opts.find((o) => o.tag === "channel-model-routing");
    expect(route?.info).toBe(true);
    expect(opts.filter((o) => o.tag === "channel-model-routing").length).toBe(1);
    const rec = route?.recommended as Record<string, string>;
    expect(rec.discord).toBeDefined();
    expect(rec.slack).toBeDefined();
  });

  it("not emitted on balanced or minimal", () => {
    const config: OpenClawConfig = { channels: { discord: {}, slack: {} } };
    expect(
      getOptimizations(config, "balanced").find((o) => o.tag === "channel-model-routing")
    ).toBeUndefined();
    expect(
      getOptimizations(config, "minimal").find((o) => o.tag === "channel-model-routing")
    ).toBeUndefined();
  });

  it("not emitted when modelByChannel already set", () => {
    const config: OpenClawConfig = {
      channels: {
        discord: {},
        modelByChannel: { discord: "haiku" } as never,
      },
    };
    expect(
      getOptimizations(config, "aggressive").find((o) => o.tag === "channel-model-routing")
    ).toBeUndefined();
  });
});

describe("getOptimizations — tools-profile", () => {
  it("balanced => coding", () => {
    const config: OpenClawConfig = { tools: { profile: "default" } };
    expect(
      getOptimizations(config, "balanced").find((o) => o.tag === "tools-profile")
        ?.recommended
    ).toBe("coding");
  });

  it("aggressive => minimal when current is default", () => {
    const config: OpenClawConfig = { tools: { profile: "default" } };
    expect(
      getOptimizations(config, "aggressive").find((o) => o.tag === "tools-profile")
        ?.recommended
    ).toBe("minimal");
  });

  it("no-op when already at target", () => {
    const config: OpenClawConfig = { tools: { profile: "minimal" } };
    expect(
      getOptimizations(config, "aggressive").find((o) => o.tag === "tools-profile")
    ).toBeUndefined();
  });

  it("treats unset as 'default' and suggests target", () => {
    const config: OpenClawConfig = {};
    expect(
      getOptimizations(config, "aggressive").find((o) => o.tag === "tools-profile")
        ?.recommended
    ).toBe("minimal");
  });
});

describe("OPTIMIZATION_TAGS", () => {
  it("includes all 17 dimensions", () => {
    expect(OPTIMIZATION_TAGS.length).toBe(17);
    expect(OPTIMIZATION_TAGS).toContain("context");
    expect(OPTIMIZATION_TAGS).toContain("tools-profile");
    expect(OPTIMIZATION_TAGS).toContain("fallback-chain");
  });
});
