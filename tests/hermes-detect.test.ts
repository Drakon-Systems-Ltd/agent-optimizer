import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({ existsSync: vi.fn() }));
vi.mock("child_process", () => ({ execSync: vi.fn() }));

import { existsSync } from "fs";
import { execSync } from "child_process";
import { homedir } from "os";
import { resolve } from "path";
import { detectSystems } from "../src/detect/index.js";

describe("detectSystems — Hermes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: nothing exists, no CLIs available
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(execSync).mockImplementation(() => { throw new Error("not found"); });
  });

  const CWD = "/fake/cwd";
  const HERMES_USER = resolve(homedir(), ".hermes", "config.yaml");
  const OC_USER = resolve(homedir(), ".openclaw", "openclaw.json");

  it("detects Hermes via ~/.hermes/config.yaml", () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === HERMES_USER);
    const systems = detectSystems(CWD);
    expect(systems).toHaveLength(1);
    expect(systems[0]).toMatchObject({ kind: "hermes", scope: "user", configPath: HERMES_USER });
  });

  it("does not detect Hermes when config.yaml is absent", () => {
    const systems = detectSystems(CWD);
    expect(systems.filter((s) => s.kind === "hermes")).toHaveLength(0);
  });

  it("includes Hermes version when hermes CLI succeeds (semver form)", () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === HERMES_USER);
    vi.mocked(execSync).mockImplementation((cmd) => {
      if (String(cmd).startsWith("hermes --version")) return Buffer.from("hermes 0.21.2") as never;
      throw new Error("not found");
    });
    const systems = detectSystems(CWD);
    expect(systems[0].version).toBe("0.21.2");
  });

  it("handles the v2026.9.11 date-tag form of hermes --version", () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === HERMES_USER);
    vi.mocked(execSync).mockImplementation((cmd) => {
      if (String(cmd).startsWith("hermes --version")) return Buffer.from("hermes v2026.9.11") as never;
      throw new Error("not found");
    });
    const systems = detectSystems(CWD);
    expect(systems[0].version).toBe("2026.9.11");
  });

  it("reports the semver form when hermes --version prints both schemes", () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === HERMES_USER);
    vi.mocked(execSync).mockImplementation((cmd) => {
      if (String(cmd).startsWith("hermes --version")) return Buffer.from("Hermes Agent 0.21.2 (v2026.9.11)") as never;
      throw new Error("not found");
    });
    const systems = detectSystems(CWD);
    expect(systems[0].version).toBe("0.21.2");
  });

  it("honours HERMES_HOME for the Hermes config path", () => {
    const prev = process.env.HERMES_HOME;
    process.env.HERMES_HOME = "/custom/hermes-home";
    try {
      const custom = resolve("/custom/hermes-home", "config.yaml");
      vi.mocked(existsSync).mockImplementation((p) => String(p) === custom);
      const systems = detectSystems(CWD);
      expect(systems).toHaveLength(1);
      expect(systems[0]).toMatchObject({ kind: "hermes", configPath: custom });
      // and the default ~/.hermes is NOT consulted while HERMES_HOME is set
      vi.mocked(existsSync).mockImplementation((p) => String(p) === HERMES_USER);
      expect(detectSystems(CWD).filter((s) => s.kind === "hermes")).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.HERMES_HOME;
      else process.env.HERMES_HOME = prev;
    }
  });

  it("returns null version when hermes CLI is not available", () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === HERMES_USER);
    // execSync default mock throws
    const systems = detectSystems(CWD);
    expect(systems[0].version).toBeNull();
  });

  it("detects Hermes and OpenClaw side by side", () => {
    vi.mocked(existsSync).mockImplementation((p) => p === HERMES_USER || p === OC_USER);
    const systems = detectSystems(CWD);
    expect(systems).toHaveLength(2);
    expect(systems.map((s) => s.kind).sort()).toEqual(["hermes", "openclaw"]);
  });
});
