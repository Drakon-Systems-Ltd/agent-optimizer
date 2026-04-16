import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";

// Isolate HOME to a tmp dir for tests
const TEST_HOME = resolve(tmpdir(), `ao-monitor-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.HOME = TEST_HOME;
  // Clear module cache so state module picks up new HOME
  vi.resetModules();
});

afterEach(() => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.HOME;
});

describe("monitor state", () => {
  it("returns null when no state file exists", async () => {
    const { loadMonitorState } = await import("../src/monitor/state.js");
    expect(loadMonitorState()).toBe(null);
  });

  it("saves and loads state", async () => {
    const { saveMonitorState, loadMonitorState } = await import("../src/monitor/state.js");
    const state = {
      token: "abc-123",
      email: "test@example.com",
      agentName: "testhost",
      enrolledAt: new Date().toISOString(),
      apiBase: "https://example.com",
    };
    saveMonitorState(state);
    expect(loadMonitorState()).toEqual(state);
  });

  it("clearMonitorState removes the state file", async () => {
    const { saveMonitorState, clearMonitorState, loadMonitorState } = await import("../src/monitor/state.js");
    saveMonitorState({
      token: "x",
      email: "a@b.c",
      agentName: "h",
      enrolledAt: new Date().toISOString(),
      apiBase: "https://e.com",
    });
    expect(loadMonitorState()).not.toBe(null);
    expect(clearMonitorState()).toBe(true);
    expect(loadMonitorState()).toBe(null);
  });

  it("clearMonitorState returns false when no state exists", async () => {
    const { clearMonitorState } = await import("../src/monitor/state.js");
    expect(clearMonitorState()).toBe(false);
  });

  it("returns null for corrupt state file", async () => {
    const { MONITOR_STATE_PATH, loadMonitorState } = await import("../src/monitor/state.js");
    mkdirSync(resolve(TEST_HOME, ".agent-optimizer"), { recursive: true });
    writeFileSync(MONITOR_STATE_PATH, "not json {{");
    expect(loadMonitorState()).toBe(null);
  });
});
