import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({ existsSync: vi.fn() }));
vi.mock("child_process", () => ({ execSync: vi.fn() }));

import { existsSync } from "fs";
import { execSync } from "child_process";
import { homedir } from "os";
import { resolve } from "path";
import { detectSystems } from "../src/detect/index.js";

describe("detectSystems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: nothing exists, no CLIs available
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(execSync).mockImplementation(() => { throw new Error("not found"); });
  });

  const CWD = "/fake/cwd";
  const CC_USER = resolve(homedir(), ".claude", "settings.json");
  const CC_PROJ_SETTINGS = resolve(CWD, ".claude", "settings.json");
  const CC_PROJ_MD = resolve(CWD, "CLAUDE.md");
  const OC_USER = resolve(homedir(), ".openclaw", "openclaw.json");
  const CURSOR_PROJ = resolve(CWD, ".cursor", "rules");

  it("returns empty when no systems are present", () => {
    expect(detectSystems(CWD)).toHaveLength(0);
  });

  it("detects Claude Code user scope", () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === CC_USER);
    const systems = detectSystems(CWD);
    expect(systems).toHaveLength(1);
    expect(systems[0]).toMatchObject({ kind: "claude-code", scope: "user", configPath: CC_USER });
  });

  it("detects Claude Code project scope via .claude/settings.json", () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === CC_PROJ_SETTINGS);
    const systems = detectSystems(CWD);
    expect(systems).toHaveLength(1);
    expect(systems[0]).toMatchObject({ kind: "claude-code", scope: "project", configPath: CC_PROJ_SETTINGS });
  });

  it("detects Claude Code project scope via CLAUDE.md when settings.json absent", () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p) === CC_PROJ_MD);
    const systems = detectSystems(CWD);
    expect(systems).toHaveLength(1);
    expect(systems[0]).toMatchObject({ kind: "claude-code", scope: "project", configPath: CC_PROJ_MD });
  });

  it("prefers settings.json over CLAUDE.md when both present (project)", () => {
    vi.mocked(existsSync).mockImplementation((p) => p === CC_PROJ_SETTINGS || p === CC_PROJ_MD);
    const systems = detectSystems(CWD);
    const project = systems.find((s) => s.scope === "project");
    expect(project?.configPath).toBe(CC_PROJ_SETTINGS);
  });

  it("detects OpenClaw", () => {
    vi.mocked(existsSync).mockImplementation((p) => p === OC_USER);
    const systems = detectSystems(CWD);
    expect(systems).toHaveLength(1);
    expect(systems[0]).toMatchObject({ kind: "openclaw", scope: "user", configPath: OC_USER });
  });

  it("detects Cursor project rules", () => {
    vi.mocked(existsSync).mockImplementation((p) => p === CURSOR_PROJ);
    const systems = detectSystems(CWD);
    expect(systems).toHaveLength(1);
    expect(systems[0]).toMatchObject({ kind: "cursor", scope: "project", configPath: CURSOR_PROJ });
  });

  it("detects both Claude Code (user) and OpenClaw side by side", () => {
    vi.mocked(existsSync).mockImplementation((p) => p === CC_USER || p === OC_USER);
    const systems = detectSystems(CWD);
    expect(systems).toHaveLength(2);
    expect(systems.map((s) => s.kind).sort()).toEqual(["claude-code", "openclaw"]);
  });

  it("includes Claude Code version when claude CLI succeeds", () => {
    vi.mocked(existsSync).mockImplementation((p) => p === CC_USER);
    vi.mocked(execSync).mockImplementation((cmd) => {
      if (String(cmd).startsWith("claude --version")) return Buffer.from("1.0.119 (Claude Code)") as never;
      throw new Error("not found");
    });
    const systems = detectSystems(CWD);
    expect(systems[0].version).toBe("1.0.119");
  });

  it("returns null version when claude CLI is not available", () => {
    vi.mocked(existsSync).mockImplementation((p) => p === CC_USER);
    // execSync default mock throws
    const systems = detectSystems(CWD);
    expect(systems[0].version).toBeNull();
  });

  it("returns user + project Claude Code as two entries when both exist", () => {
    vi.mocked(existsSync).mockImplementation((p) => p === CC_USER || p === CC_PROJ_SETTINGS);
    const systems = detectSystems(CWD);
    expect(systems.filter((s) => s.kind === "claude-code")).toHaveLength(2);
    const scopes = systems.filter((s) => s.kind === "claude-code").map((s) => s.scope).sort();
    expect(scopes).toEqual(["project", "user"]);
  });
});
