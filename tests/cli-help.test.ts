import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import { join } from "path";

const CLI = join(process.cwd(), "src", "cli.ts");

function runHelp(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
    encoding: "utf-8",
    cwd: process.cwd(),
    // No ANSI codes so substring assertions see the plain text.
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    // A hung CLI must fail fast (SIGKILL) rather than stall CI.
    timeout: 20000,
    killSignal: "SIGKILL",
  });
}

describe("cli --help", () => {
  it("lists plugin install [--enable] in the top-level help screen (README parity)", () => {
    const r = runHelp("--help");
    expect(r.status).toBe(0);
    // README documents `agent-optimizer plugin install` and `plugin install --enable`;
    // the custom help banner must advertise the same command.
    expect(r.stdout).toContain("plugin install");
    expect(r.stdout).toMatch(/plugin install\s+\[--enable\]/);
    expect(r.stdout).toContain("Install the bundled OpenClaw plugin");
  });

  it("documents --enable on the plugin install subcommand help", () => {
    const r = runHelp("plugin", "install", "--help");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--enable");
    expect(r.stdout).toContain("plugins.allow");
  });
});
