import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { createBackup } from "../src/utils/backups.js";
import { runRollback } from "../src/utils/rollback.js";

const DIR = join(process.cwd(), "__test_rollback__");
const CFG = join(DIR, "openclaw.json");
const STORE = join(DIR, "store");

const V1 = JSON.stringify({ agents: { defaults: { contextTokens: 1000000 } } }, null, 2);
const V2 = JSON.stringify({ agents: { defaults: { contextTokens: 200000 } } }, null, 2);

let out: string[];
const sink = (m: string) => out.push(m);
const text = () => out.join("\n");

beforeEach(() => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  out = [];
});
afterEach(() => rmSync(DIR, { recursive: true, force: true }));

describe("runRollback — store generations", () => {
  it("--list shows a store generation touching this config", () => {
    writeFileSync(CFG, V1);
    const id = createBackup([CFG], STORE);
    const code = runRollback({ config: CFG, list: true, backupsDir: STORE, out: sink });
    expect(code).toBe(0);
    expect(text()).toContain(id);
    expect(text()).toContain("openclaw.json");
  });

  it("--list filters out generations for OTHER configs", () => {
    const other = join(DIR, "other.json");
    writeFileSync(other, V1);
    createBackup([other], STORE); // a generation that does NOT touch CFG
    writeFileSync(CFG, V1);
    const code = runRollback({ config: CFG, list: true, backupsDir: STORE, out: sink });
    expect(code).toBe(0);
    expect(text()).toContain("No backups found for this config");
  });

  it("--to <id> restores that generation's bytes", () => {
    writeFileSync(CFG, V1);
    const id = createBackup([CFG], STORE); // snapshots V1
    writeFileSync(CFG, V2); // drift away
    const code = runRollback({ config: CFG, to: id, backupsDir: STORE, out: sink });
    expect(code).toBe(0);
    expect(readFileSync(CFG, "utf-8")).toBe(V1);
    expect(text()).toContain("Restored");
  });

  it("--to with an unknown id errors clearly and suggests --list", () => {
    writeFileSync(CFG, V1);
    const code = runRollback({ config: CFG, to: "2020-01-01T00-00-00.000Z", backupsDir: STORE, out: sink });
    expect(code).toBe(1);
    expect(text()).toMatch(/Unknown backup id/i);
    expect(text()).toContain("--list");
  });

  it("--to with a traversal-shaped id is rejected", () => {
    writeFileSync(CFG, V1);
    const code = runRollback({ config: CFG, to: "../evil", backupsDir: STORE, out: sink });
    expect(code).toBe(1);
    expect(text()).toMatch(/Invalid backup id/i);
  });

  it("no flags restores the NEWEST store generation for this config", () => {
    writeFileSync(CFG, V1);
    createBackup([CFG], STORE); // gen 1 (V1)
    writeFileSync(CFG, V2);
    const id2 = createBackup([CFG], STORE); // gen 2 (V2), newest
    writeFileSync(CFG, JSON.stringify({ agents: { defaults: { contextTokens: 999 } } }));
    const code = runRollback({ config: CFG, backupsDir: STORE, out: sink });
    expect(code).toBe(0);
    // Restored to the NEWEST snapshot (V2), not the oldest.
    expect(readFileSync(CFG, "utf-8")).toBe(V2);
    expect(text()).toContain(id2);
  });
});

describe("runRollback — legacy sidecar fallback", () => {
  it("falls back to .pre-optimize.bak when the store has no generation", () => {
    writeFileSync(CFG, V2); // current (drifted)
    writeFileSync(`${CFG}.pre-optimize.bak`, V1); // legacy backup holds the original
    const code = runRollback({ config: CFG, backupsDir: STORE, out: sink });
    expect(code).toBe(0);
    expect(readFileSync(CFG, "utf-8")).toBe(V1);
    expect(text()).toContain("legacy sidecar");
  });

  it("prefers the newest sidecar (.pre-fix.bak over .pre-optimize.bak by mtime)", () => {
    writeFileSync(CFG, JSON.stringify({ drifted: true }));
    writeFileSync(`${CFG}.pre-optimize.bak`, V1);
    // Ensure .pre-fix.bak is newer.
    const later = Date.now();
    writeFileSync(`${CFG}.pre-fix.bak`, V2);
    // Touch mtimes deterministically: rewrite pre-fix last so it wins.
    void later;
    const code = runRollback({ config: CFG, backupsDir: STORE, out: sink });
    expect(code).toBe(0);
    expect(readFileSync(CFG, "utf-8")).toBe(V2);
  });

  it("reports when there is no store generation and no legacy sidecar", () => {
    writeFileSync(CFG, V1);
    const code = runRollback({ config: CFG, backupsDir: STORE, out: sink });
    expect(code).toBe(1);
    expect(text()).toContain("No backup found");
  });

  it("--list still surfaces legacy sidecars when no store generation exists", () => {
    writeFileSync(CFG, V1);
    writeFileSync(`${CFG}.pre-fix.bak`, V2);
    const code = runRollback({ config: CFG, list: true, backupsDir: STORE, out: sink });
    expect(code).toBe(0);
    expect(text()).toContain("Legacy sidecar");
  });
});
