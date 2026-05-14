import { describe, it, expect } from "vitest";
import {
  getClaudeCodeOptimizations,
  isBroadRead,
  type ClaudeCodeSettings,
} from "../src/optimizers/claude-code/index.js";

// ── cc-allow-size ──────────────────────────────────────────────────
describe("getClaudeCodeOptimizations — cc-allow-size", () => {
  it("flags when allow exceeds balanced limit (150)", () => {
    const settings: ClaudeCodeSettings = {
      permissions: { allow: new Array(200).fill("Bash(echo:*)"), deny: ["Bash(rm:*)"] },
    };
    const opts = getClaudeCodeOptimizations(settings, 0, "balanced");
    const hit = opts.find((o) => o.tag === "cc-allow-size");
    expect(hit).toBeDefined();
    expect(hit?.info).toBe(true);
    expect(hit?.current).toBe(200);
    expect(hit?.recommended).toBe(150);
  });

  it("no-op when below limit on minimal (300)", () => {
    const settings: ClaudeCodeSettings = {
      permissions: { allow: new Array(50).fill("Bash(echo:*)"), deny: ["Bash(rm:*)"] },
    };
    const opts = getClaudeCodeOptimizations(settings, 0, "minimal");
    expect(opts.some((o) => o.tag === "cc-allow-size")).toBe(false);
  });

  it("flags at lower threshold on aggressive (100)", () => {
    const settings: ClaudeCodeSettings = {
      permissions: { allow: new Array(120).fill("Bash(echo:*)"), deny: ["Bash(rm:*)"] },
    };
    const opts = getClaudeCodeOptimizations(settings, 0, "aggressive");
    expect(opts.some((o) => o.tag === "cc-allow-size")).toBe(true);
  });
});

// ── cc-add-deny ────────────────────────────────────────────────────
describe("getClaudeCodeOptimizations — cc-add-deny", () => {
  it("flags when deny is missing", () => {
    const settings: ClaudeCodeSettings = {
      permissions: { allow: ["Bash(echo:*)"] },
    };
    const opts = getClaudeCodeOptimizations(settings, 0, "balanced");
    const hit = opts.find((o) => o.tag === "cc-add-deny");
    expect(hit).toBeDefined();
    expect(hit?.info).toBe(true);
    expect(Array.isArray(hit?.recommended)).toBe(true);
  });

  it("flags when deny is an empty array", () => {
    const settings: ClaudeCodeSettings = {
      permissions: { allow: ["Bash(echo:*)"], deny: [] },
    };
    const opts = getClaudeCodeOptimizations(settings, 0, "balanced");
    expect(opts.some((o) => o.tag === "cc-add-deny")).toBe(true);
  });

  it("no-op when deny has entries", () => {
    const settings: ClaudeCodeSettings = {
      permissions: { allow: ["Bash(echo:*)"], deny: ["Bash(rm:*)"] },
    };
    const opts = getClaudeCodeOptimizations(settings, 0, "balanced");
    expect(opts.some((o) => o.tag === "cc-add-deny")).toBe(false);
  });
});

// ── cc-broad-reads ─────────────────────────────────────────────────
describe("getClaudeCodeOptimizations — cc-broad-reads", () => {
  it("isBroadRead: flags Read(//Users/michael/Dev)", () => {
    expect(isBroadRead("Read(//Users/michael/Dev)")).toBe(true);
  });

  it("isBroadRead: ignores Read(//Users/.../**)", () => {
    expect(isBroadRead("Read(//Users/michael/Dev/**)")).toBe(false);
  });

  it("isBroadRead: ignores Read(...file.ext)", () => {
    expect(isBroadRead("Read(//Users/michael/notes.md)")).toBe(false);
  });

  it("isBroadRead: ignores non-Read entries", () => {
    expect(isBroadRead("Bash(echo:*)")).toBe(false);
  });

  it("flags broad reads on aggressive (limit 0)", () => {
    const settings: ClaudeCodeSettings = {
      permissions: {
        allow: ["Read(//Users/michael/Dev)", "Bash(echo:*)"],
        deny: ["Bash(rm:*)"],
      },
    };
    const opts = getClaudeCodeOptimizations(settings, 0, "aggressive");
    const hit = opts.find((o) => o.tag === "cc-broad-reads");
    expect(hit).toBeDefined();
    expect(hit?.current).toBe(1);
  });

  it("allows up to 3 broad reads on minimal", () => {
    const settings: ClaudeCodeSettings = {
      permissions: {
        allow: [
          "Read(//Users/michael/Dev)",
          "Read(//Users/michael/Docs)",
          "Read(//Users/michael/Notes)",
        ],
        deny: ["Bash(rm:*)"],
      },
    };
    const opts = getClaudeCodeOptimizations(settings, 0, "minimal");
    expect(opts.some((o) => o.tag === "cc-broad-reads")).toBe(false);
  });

  it("flags 2 broad reads on balanced (limit 1)", () => {
    const settings: ClaudeCodeSettings = {
      permissions: {
        allow: ["Read(//Users/michael/Dev)", "Read(//Users/michael/Docs)"],
        deny: ["Bash(rm:*)"],
      },
    };
    const opts = getClaudeCodeOptimizations(settings, 0, "balanced");
    expect(opts.some((o) => o.tag === "cc-broad-reads")).toBe(true);
  });
});

// ── cc-memory-trim ─────────────────────────────────────────────────
describe("getClaudeCodeOptimizations — cc-memory-trim", () => {
  it("flags when memory exceeds balanced limit (40k)", () => {
    const settings: ClaudeCodeSettings = {
      permissions: { allow: [], deny: ["Bash(rm:*)"] },
    };
    const opts = getClaudeCodeOptimizations(settings, 50_000, "balanced");
    const hit = opts.find((o) => o.tag === "cc-memory-trim");
    expect(hit).toBeDefined();
    expect(hit?.current).toBe(50_000);
    expect(hit?.recommended).toBe(40_000);
  });

  it("no-op when memory below aggressive limit (20k)", () => {
    const settings: ClaudeCodeSettings = {
      permissions: { allow: [], deny: ["Bash(rm:*)"] },
    };
    const opts = getClaudeCodeOptimizations(settings, 10_000, "aggressive");
    expect(opts.some((o) => o.tag === "cc-memory-trim")).toBe(false);
  });

  it("flags large memory on aggressive (20k limit)", () => {
    const settings: ClaudeCodeSettings = {
      permissions: { allow: [], deny: ["Bash(rm:*)"] },
    };
    const opts = getClaudeCodeOptimizations(settings, 25_000, "aggressive");
    expect(opts.some((o) => o.tag === "cc-memory-trim")).toBe(true);
  });
});

// ── cc-hook-timeout-budget ─────────────────────────────────────────
describe("getClaudeCodeOptimizations — cc-hook-timeout-budget", () => {
  it("flags a slow UserPromptSubmit hook (timeout > 10s)", () => {
    const settings: ClaudeCodeSettings = {
      permissions: { allow: [], deny: ["Bash(rm:*)"] },
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: "slow-script", timeout: 30 }] },
        ],
      },
    };
    const opts = getClaudeCodeOptimizations(settings, 0, "balanced");
    const hit = opts.find((o) => o.tag === "cc-hook-timeout-budget");
    expect(hit).toBeDefined();
    expect(hit?.path).toBe("hooks.UserPromptSubmit");
  });

  it("does not flag SessionEnd hooks (not hot path)", () => {
    const settings: ClaudeCodeSettings = {
      permissions: { allow: [], deny: ["Bash(rm:*)"] },
      hooks: {
        SessionEnd: [
          { hooks: [{ type: "command", command: "cleanup", timeout: 60 }] },
        ],
      },
    };
    const opts = getClaudeCodeOptimizations(settings, 0, "balanced");
    expect(opts.some((o) => o.tag === "cc-hook-timeout-budget")).toBe(false);
  });

  it("does not flag a fast PreToolUse hook (timeout <= 10s)", () => {
    const settings: ClaudeCodeSettings = {
      permissions: { allow: [], deny: ["Bash(rm:*)"] },
      hooks: {
        PreToolUse: [
          { hooks: [{ type: "command", command: "fast", timeout: 5 }] },
        ],
      },
    };
    const opts = getClaudeCodeOptimizations(settings, 0, "balanced");
    expect(opts.some((o) => o.tag === "cc-hook-timeout-budget")).toBe(false);
  });

  it("does not flag PreCompact (not hot path)", () => {
    const settings: ClaudeCodeSettings = {
      permissions: { allow: [], deny: ["Bash(rm:*)"] },
      hooks: {
        PreCompact: [
          { hooks: [{ type: "command", command: "extract", timeout: 60 }] },
        ],
      },
    };
    const opts = getClaudeCodeOptimizations(settings, 0, "balanced");
    expect(opts.some((o) => o.tag === "cc-hook-timeout-budget")).toBe(false);
  });

  it("does not flag Stop (not hot path)", () => {
    const settings: ClaudeCodeSettings = {
      permissions: { allow: [], deny: ["Bash(rm:*)"] },
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "post", timeout: 60 }] },
        ],
      },
    };
    const opts = getClaudeCodeOptimizations(settings, 0, "balanced");
    expect(opts.some((o) => o.tag === "cc-hook-timeout-budget")).toBe(false);
  });
});

// ── all-info flag ──────────────────────────────────────────────────
describe("getClaudeCodeOptimizations — all recommendations are info-only", () => {
  it("every returned entry has info: true (apply blocked in v0.11.0)", () => {
    const settings: ClaudeCodeSettings = {
      permissions: {
        allow: new Array(200).fill("Bash(echo:*)").concat(["Read(//Users/x/y)"]),
      },
      hooks: {
        UserPromptSubmit: [{ hooks: [{ command: "slow", timeout: 30 }] }],
      },
    };
    const opts = getClaudeCodeOptimizations(settings, 100_000, "balanced");
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) {
      expect(o.info).toBe(true);
    }
  });
});
