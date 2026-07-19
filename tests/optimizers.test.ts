import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import type { OpenClawConfig } from "../src/types.js";
import { getOptimizations, OPTIMIZATION_TAGS } from "../src/optimizers/index.js";
import { runOpenClawOptimize } from "../src/optimizers/openclaw/index.js";
import { listBackups } from "../src/utils/backups.js";

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

describe("getOptimizations — runRetries-cap (info-only)", () => {
  it("fires when max=160 on aggressive (recommended.max===50, preserves other keys, info)", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: {
          runRetries: { base: 24, perProfile: 8, min: 32, max: 160 } as never,
        },
      },
    };
    const cap = getOptimizations(config, "aggressive").find(
      (o) => o.tag === "runRetries-cap"
    );
    expect(cap).toBeDefined();
    expect(cap?.info).toBe(true);
    expect(cap?.current).toBe(160);
    const rec = cap?.recommended as Record<string, number>;
    expect(rec.max).toBe(50);
    // preserves existing sub-keys
    expect(rec.base).toBe(24);
    expect(rec.perProfile).toBe(8);
    expect(rec.min).toBe(32);
  });

  it("preserves a custom min so max>=min (min=60 -> safeMax=60 not 50)", () => {
    const config: OpenClawConfig = {
      agents: {
        defaults: { runRetries: { min: 60, max: 160 } as never },
      },
    };
    const cap = getOptimizations(config, "aggressive").find(
      (o) => o.tag === "runRetries-cap"
    );
    expect(cap).toBeDefined();
    const rec = cap?.recommended as Record<string, number>;
    expect(rec.max).toBe(60);
    expect(rec.min).toBe(60);
  });

  it("no-op when max already <= target (balanced target=96, max=90)", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { runRetries: { max: 90 } as never } },
    };
    expect(
      getOptimizations(config, "balanced").find((o) => o.tag === "runRetries-cap")
    ).toBeUndefined();
  });

  it("no-op when unset on minimal (default 160 === target 160)", () => {
    const config: OpenClawConfig = { agents: { defaults: {} } };
    expect(
      getOptimizations(config, "minimal").find((o) => o.tag === "runRetries-cap")
    ).toBeUndefined();
  });

  it("no-op when safeMax cannot drop below current (min>=current already)", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { runRetries: { min: 200, max: 160 } as never } },
    };
    // existingMin=200, safeMax=max(50,200)=200, 200 !< 160 → skip
    expect(
      getOptimizations(config, "aggressive").find((o) => o.tag === "runRetries-cap")
    ).toBeUndefined();
  });
});

describe("getOptimizations — discord-suppress-embeds (info-only)", () => {
  it("fires only when suppressEmbeds===false on balanced/aggressive (info)", () => {
    const config: OpenClawConfig = {
      channels: { discord: { suppressEmbeds: false } as never },
    };
    const balanced = getOptimizations(config, "balanced").find(
      (o) => o.tag === "discord-suppress-embeds"
    );
    expect(balanced).toBeDefined();
    expect(balanced?.info).toBe(true);
    expect(balanced?.current).toBe(false);
    expect(balanced?.recommended).toBe(true);
    expect(
      getOptimizations(config, "aggressive").find(
        (o) => o.tag === "discord-suppress-embeds"
      )
    ).toBeDefined();
  });

  it("no-op when suppressEmbeds true or unset", () => {
    const trueCfg: OpenClawConfig = {
      channels: { discord: { suppressEmbeds: true } as never },
    };
    const unsetCfg: OpenClawConfig = { channels: { discord: {} } };
    expect(
      getOptimizations(trueCfg, "balanced").find(
        (o) => o.tag === "discord-suppress-embeds"
      )
    ).toBeUndefined();
    expect(
      getOptimizations(unsetCfg, "balanced").find(
        (o) => o.tag === "discord-suppress-embeds"
      )
    ).toBeUndefined();
  });

  it("no-op on minimal even when suppressEmbeds===false", () => {
    const config: OpenClawConfig = {
      channels: { discord: { suppressEmbeds: false } as never },
    };
    expect(
      getOptimizations(config, "minimal").find(
        (o) => o.tag === "discord-suppress-embeds"
      )
    ).toBeUndefined();
  });
});

describe("getOptimizations — slack-unfurl-links (info-only)", () => {
  it("fires only when unfurlLinks===true on balanced/aggressive (info)", () => {
    const config: OpenClawConfig = {
      channels: { slack: { unfurlLinks: true } as never },
    };
    const aggressive = getOptimizations(config, "aggressive").find(
      (o) => o.tag === "slack-unfurl-links"
    );
    expect(aggressive).toBeDefined();
    expect(aggressive?.info).toBe(true);
    expect(aggressive?.current).toBe(true);
    expect(aggressive?.recommended).toBe(false);
    expect(
      getOptimizations(config, "balanced").find((o) => o.tag === "slack-unfurl-links")
    ).toBeDefined();
  });

  it("no-op when unfurlLinks false or unset", () => {
    const falseCfg: OpenClawConfig = {
      channels: { slack: { unfurlLinks: false } as never },
    };
    const unsetCfg: OpenClawConfig = { channels: { slack: {} } };
    expect(
      getOptimizations(falseCfg, "balanced").find((o) => o.tag === "slack-unfurl-links")
    ).toBeUndefined();
    expect(
      getOptimizations(unsetCfg, "balanced").find((o) => o.tag === "slack-unfurl-links")
    ).toBeUndefined();
  });

  it("no-op on minimal even when unfurlLinks===true", () => {
    const config: OpenClawConfig = {
      channels: { slack: { unfurlLinks: true } as never },
    };
    expect(
      getOptimizations(config, "minimal").find((o) => o.tag === "slack-unfurl-links")
    ).toBeUndefined();
  });
});

describe("getOptimizations — risk + requiresRestart metadata", () => {
  it("every optimization carries risk and requiresRestart metadata", () => {
    const config: OpenClawConfig = {
      agents: { defaults: { contextTokens: 1000000, heartbeat: { every: "30m" } } },
    };
    const opts = getOptimizations(config, "balanced");
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) {
      expect(["low", "medium", "high"]).toContain(o.risk);
      expect(typeof o.requiresRestart).toBe("boolean");
    }
    // Pin one exact value so the map can't silently drift to all-defaults.
    expect(opts.find((o) => o.tag === "context")).toMatchObject({
      risk: "low",
      requiresRestart: false,
    });
  });
});

describe("OPTIMIZATION_TAGS", () => {
  it("includes all 20 dimensions", () => {
    expect(OPTIMIZATION_TAGS.length).toBe(20);
    expect(OPTIMIZATION_TAGS).toContain("context");
    expect(OPTIMIZATION_TAGS).toContain("tools-profile");
    expect(OPTIMIZATION_TAGS).toContain("fallback-chain");
    expect(OPTIMIZATION_TAGS).toContain("runRetries-cap");
    expect(OPTIMIZATION_TAGS).toContain("discord-suppress-embeds");
    expect(OPTIMIZATION_TAGS).toContain("slack-unfurl-links");
  });
});

// ── Apply path: routed through the transactional backup store ──────────
describe("runOpenClawOptimize — transactional apply", () => {
  const DIR = join(process.cwd(), "__test_optimize_apply__");
  const CFG = join(DIR, "openclaw.json");
  // Store lives under DIR so it (and the derived apply.lock) is torn down here;
  // nothing ever touches the real ~/.agent-optimizer.
  const STORE = join(DIR, "store");
  const LOCK = join(DIR, "apply.lock"); // = dirname(resolve(STORE))/apply.lock
  let logSpy: ReturnType<typeof vi.spyOn>;
  let prevExitCode: typeof process.exitCode;

  // A config that triggers real applicable optimizations on `aggressive`
  // (contextTokens 1M → 100k) and carries a valid primary so the baseline is clean.
  const VALID = {
    agents: {
      defaults: {
        model: { primary: "anthropic/claude-opus-4-8", fallbacks: ["openai/gpt-5.6"] },
        contextTokens: 1000000,
      },
    },
  };

  beforeEach(() => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    prevExitCode = process.exitCode;
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    process.exitCode = prevExitCode;
    rmSync(DIR, { recursive: true, force: true });
  });

  const logged = () => logSpy.mock.calls.map((c) => String(c[0])).join("\n");

  it("applies, writes a store backup (not a sidecar), and leaves a clean config", async () => {
    writeFileSync(CFG, JSON.stringify(VALID, null, 2));
    await runOpenClawOptimize({ config: CFG, profile: "aggressive", backupsDir: STORE });

    // The change landed on disk.
    expect(JSON.parse(readFileSync(CFG, "utf-8")).agents.defaults.contextTokens).toBe(100000);
    // A single store generation snapshots the config; the old sidecar is gone.
    const gens = listBackups(STORE);
    expect(gens).toHaveLength(1);
    expect(gens[0].files).toEqual(["openclaw.json"]);
    expect(existsSync(`${CFG}.pre-optimize.bak`)).toBe(false);
    // Success path prints the backup id and does not set a failing exit code.
    expect(logged()).toContain(gens[0].id);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("warns about JSON5 rewrite but still applies (backup preserves the original)", async () => {
    // Valid JSON5 (comment) — parses via the JSON5 path, throws under strict JSON.
    const json5 = `{\n  // heavy context\n  "agents": { "defaults": { "model": { "primary": "anthropic/claude-opus-4-8", "fallbacks": ["openai/gpt-5.6"] }, "contextTokens": 1000000 } }\n}`;
    writeFileSync(CFG, json5);
    await runOpenClawOptimize({ config: CFG, profile: "aggressive", backupsDir: STORE });

    expect(logged()).toContain("JSON5");
    // The file is now plain JSON (the comment is gone) and reflects the change.
    const rewritten = readFileSync(CFG, "utf-8");
    expect(rewritten).not.toContain("// heavy context");
    expect(JSON.parse(rewritten).agents.defaults.contextTokens).toBe(100000);
    // The backup captured the ORIGINAL JSON5 bytes.
    const gens = listBackups(STORE);
    expect(gens).toHaveLength(1);
  });

  it("surfaces a locked apply: config untouched, no backup, exit 1", async () => {
    const original = JSON.stringify(VALID, null, 2);
    writeFileSync(CFG, original);
    // Pre-hold a FRESH lock at the derived lock dir so acquireLock refuses.
    mkdirSync(LOCK, { recursive: true });
    writeFileSync(join(LOCK, "lock.json"), JSON.stringify({ pid: 999999, startedAt: Date.now() }));

    await runOpenClawOptimize({ config: CFG, profile: "aggressive", backupsDir: STORE });

    // The optimizer caught the ApplyLockedError, formatted it, and set exit 1.
    expect(process.exitCode).toBe(1);
    expect(logged()).toContain("Another apply is already in progress");
    // Nothing was written or backed up.
    expect(readFileSync(CFG, "utf-8")).toBe(original);
    expect(listBackups(STORE)).toHaveLength(0);
  });

  it("does not rewrite or back up the file when only info-only suggestions apply", async () => {
    // Tuned so aggressive fires ONLY info-only optimizations (fallback-chain,
    // runRetries-cap) and nothing applicable — every writable dimension already
    // sits at/under its aggressive target.
    const onlyInfo = {
      agents: {
        defaults: {
          model: { primary: "anthropic/claude-opus-4-8", fallbacks: ["openai/gpt-5.6"] },
          contextTokens: 100000,
          heartbeat: { every: "12h", isolatedSession: true },
          subagents: { maxConcurrent: 2 },
          compaction: { mode: "safeguard" },
          contextPruning: { mode: "cache-ttl" },
          imageMaxDimensionPx: 800,
          bootstrapMaxChars: 10000,
          bootstrapTotalMaxChars: 100000,
        },
      },
      tools: { profile: "minimal" },
    };
    // Deliberately unusual formatting (single line) so a re-serialize would change bytes.
    const original = JSON.stringify(onlyInfo);
    writeFileSync(CFG, original);
    await runOpenClawOptimize({ config: CFG, profile: "aggressive", backupsDir: STORE });

    // Byte-identical (no re-serialize) and no backup generation created.
    expect(readFileSync(CFG, "utf-8")).toBe(original);
    expect(listBackups(STORE)).toHaveLength(0);
  });
});
