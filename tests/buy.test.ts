import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  browserOpenCommand,
  buildBuyUrl,
  openPurchasePage,
  parseBuyTier,
} from "../src/utils/buy.js";

const baseUrl = "https://drakonsystems.com/products/agent-optimizer/buy?tier=";

describe("buy tier", () => {
  for (const tier of ["solo", "fleet", "lifetime"] as const) {
    it(`accepts ${tier} and preserves its URL`, () => {
      const launcher = vi.fn();
      expect(parseBuyTier(tier)).toBe(tier);
      expect(buildBuyUrl(tier)).toBe(baseUrl + tier);
      expect(openPurchasePage(tier, { platform: "linux", launcher })).toBe(baseUrl + tier);
      expect(launcher).toHaveBeenCalledExactlyOnceWith(
        "xdg-open", [baseUrl + tier], expect.any(Function)
      );
    });
  }

  it("defaults to fleet", () => {
    const launcher = vi.fn();
    expect(openPurchasePage(undefined, { platform: "linux", launcher })).toBe(baseUrl + "fleet");
    expect(launcher).toHaveBeenCalledExactlyOnceWith(
      "xdg-open", [baseUrl + "fleet"], expect.any(Function)
    );
  });

  for (const input of [
    'fleet"; touch /tmp/x; "', "$(id)", "`id`", "fleet&calc", "solo|sh",
    "", "FLEET ", "enterprise", "FLEET",
  ]) {
    it(`rejects ${JSON.stringify(input)} before launching`, () => {
      const launcher = vi.fn();
      expect(parseBuyTier(input)).toBeNull();
      expect(openPurchasePage(input, { platform: "linux", launcher })).toBeNull();
      expect(launcher).not.toHaveBeenCalled();
    });
  }
});

describe("browser command", () => {
  for (const [platform, file, prefix] of [
    ["darwin", "open", []],
    ["linux", "xdg-open", []],
    ["win32", "rundll32", ["url.dll,FileProtocolHandler"]],
  ] as const) {
    it(`uses an argv vector on ${platform}`, () => {
      const url = baseUrl + "solo";
      expect(browserOpenCommand(platform, url)).toEqual({ file, args: [...prefix, url] });
      const launcher = vi.fn();
      openPurchasePage("solo", { platform, launcher });
      expect(launcher).toHaveBeenCalledExactlyOnceWith(file, [...prefix, url], expect.any(Function));
    });
  }

  it("refuses a URL outside the fixed purchase URL allowlist", () => {
    expect(() => browserOpenCommand("win32", baseUrl + "solo&calc")).toThrow();
  });
});

// End to end through the real CLI: a fake browser opener on PATH records what
// it was given, so this proves the shipped `buy` command never reaches a shell
// with an invalid tier and passes a valid URL through as one argv element.
describe.skipIf(process.platform === "win32")("cli buy", () => {
  const CLI = join(process.cwd(), "src", "cli.ts");
  let dir: string;
  let marker: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ao-buy-"));
    marker = join(dir, "opened.txt");
    const bin = join(dir, "bin");
    mkdirSync(bin);
    for (const name of ["xdg-open", "open"]) {
      const p = join(bin, name);
      writeFileSync(p, `#!/bin/sh\nprintf '%s\\n' "$#" "$@" > "${marker}"\n`);
      chmodSync(p, 0o755);
    }
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function runBuy(...args: string[]) {
    return spawnSync(process.execPath, ["--import", "tsx", CLI, "buy", ...args], {
      encoding: "utf-8",
      cwd: process.cwd(),
      env: { ...process.env, HOME: dir, PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}` },
      timeout: 20000,
      killSignal: "SIGKILL",
    });
  }

  it("rejects a shell-active tier with exit 1 and never launches the opener", () => {
    const r = runBuy("--tier", `fleet"; touch ${join(dir, "pwned")}; "`);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Invalid tier\. Valid tiers: solo, fleet, lifetime/);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(dir, "pwned"))).toBe(false);
  });

  it("passes the exact purchase URL as a single argv element", () => {
    const r = runBuy("--tier", "lifetime");
    expect(r.status).toBe(0);
    expect(readFileSync(marker, "utf-8")).toBe(`1\n${baseUrl}lifetime\n`);
  });
});
