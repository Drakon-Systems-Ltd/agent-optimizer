import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Root `--help` is hand-written in src/cli.ts and groups commands by tier.
// Owner decision (23 Oct 2026): rollback is free; only applying fixes
// (`audit --fix`, `optimize`) needs a licence. README.md says the same.
describe("root --help tier headings (spawned, temp HOME, no network)", () => {
  const CLI = join(process.cwd(), "src", "cli.ts");
  let HOME: string;

  beforeEach(() => {
    HOME = mkdtempSync(join(tmpdir(), "ao-help-cli-"));
  });
  afterEach(() => {
    rmSync(HOME, { recursive: true, force: true });
  });

  function help(): string {
    const r = spawnSync(process.execPath, ["--import", "tsx", CLI, "--help"], {
      encoding: "utf-8",
      cwd: process.cwd(),
      env: { ...process.env, HOME, NO_COLOR: "1", FORCE_COLOR: "0" },
      timeout: 20000,
      killSignal: "SIGKILL",
    });
    expect(r.status).toBe(0);
    return r.stdout;
  }

  // Lines between one tier heading and the next blank line.
  function block(out: string, heading: string): string[] {
    const lines = out.split("\n");
    const start = lines.findIndex((l) => l.trim().startsWith(heading));
    expect(start, `heading ${heading} present`).toBeGreaterThanOrEqual(0);
    const rows: string[] = [];
    for (let i = start + 1; i < lines.length && lines[i].trim() !== ""; i++) rows.push(lines[i]);
    return rows;
  }

  it("lists rollback under FREE, not under LICENSED", () => {
    const out = help();
    const free = block(out, "FREE");
    const licensed = block(out, "LICENSED");

    expect(free.some((l) => /^\s+rollback\b/.test(l))).toBe(true);
    expect(licensed.some((l) => /\brollback\b/.test(l))).toBe(false);
  });

  it("keeps the paid rows under LICENSED", () => {
    const licensed = block(help(), "LICENSED");
    expect(licensed.some((l) => /^\s+audit --fix\b/.test(l))).toBe(true);
    expect(licensed.some((l) => /^\s+optimize\b/.test(l))).toBe(true);
  });
});
