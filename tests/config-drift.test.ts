import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { detectDrift, saveSnapshot } from "../src/auditors/openclaw/config-drift.js";

const TEST_CONFIG_DIR = join(process.cwd(), "__test_drift__");
const CONFIG_PATH = join(TEST_CONFIG_DIR, "openclaw.json");
const SNAPSHOT_DIR = join(homedir(), ".agent-optimizer", "snapshots");

function writeConfig(overrides: Record<string, unknown> = {}) {
  const config = {
    agents: {
      defaults: {
        model: { primary: "anthropic/claude-sonnet-4-6", fallbacks: ["openai/gpt-4o"] },
        contextTokens: 200000,
        heartbeat: { every: "6h" },
        compaction: { mode: "safeguard" },
        contextPruning: { mode: "cache-ttl", ttl: "2h" },
        ...overrides,
      },
    },
    plugins: { allow: ["telegram", "browser"] },
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

beforeEach(() => {
  mkdirSync(TEST_CONFIG_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_CONFIG_DIR)) rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  // Clean up test snapshot
  const snapPath = join(SNAPSHOT_DIR, "test-drift.json");
  if (existsSync(snapPath)) rmSync(snapPath);
});

describe("config drift detection", () => {
  it("reports no drift when config matches snapshot", () => {
    writeConfig();
    saveSnapshot(CONFIG_PATH, "test-drift");
    const results = detectDrift(CONFIG_PATH, "test-drift");
    expect(results.some((r) => r.status === "pass" && r.message.includes("No drift"))).toBe(true);
  });

  it("detects changed contextTokens", () => {
    writeConfig();
    saveSnapshot(CONFIG_PATH, "test-drift");
    writeConfig({ contextTokens: 500000 });
    const results = detectDrift(CONFIG_PATH, "test-drift");
    expect(results.some((r) => r.check === "Changed: contextTokens")).toBe(true);
  });

  it("detects changed primary model", () => {
    writeConfig();
    saveSnapshot(CONFIG_PATH, "test-drift");
    writeConfig({ model: { primary: "openai/gpt-4o", fallbacks: [] } });
    const results = detectDrift(CONFIG_PATH, "test-drift");
    expect(results.some((r) => r.check === "Changed: model.primary")).toBe(true);
  });

  it("detects changed heartbeat", () => {
    writeConfig();
    saveSnapshot(CONFIG_PATH, "test-drift");
    writeConfig({ heartbeat: { every: "1h" } });
    const results = detectDrift(CONFIG_PATH, "test-drift");
    expect(results.some((r) => r.check === "Changed: heartbeat.every")).toBe(true);
  });

  it("fails when snapshot does not exist", () => {
    writeConfig();
    const results = detectDrift(CONFIG_PATH, "nonexistent-snapshot");
    expect(results.some((r) => r.status === "fail" && r.message.includes("not found"))).toBe(true);
  });

  it("shows drift summary with count", () => {
    writeConfig();
    saveSnapshot(CONFIG_PATH, "test-drift");
    writeConfig({ contextTokens: 999000, heartbeat: { every: "30m" } });
    const results = detectDrift(CONFIG_PATH, "test-drift");
    expect(results.some((r) => r.check === "Drift summary")).toBe(true);
  });
});
