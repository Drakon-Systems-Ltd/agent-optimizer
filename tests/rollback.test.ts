import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, utimesSync } from "fs";
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
    const { exitCode: code } = runRollback({ config: CFG, list: true, backupsDir: STORE, out: sink });
    expect(code).toBe(0);
    expect(text()).toContain(id);
    expect(text()).toContain("openclaw.json");
  });

  it("--list filters out generations for OTHER configs", () => {
    const other = join(DIR, "other.json");
    writeFileSync(other, V1);
    createBackup([other], STORE); // a generation that does NOT touch CFG
    writeFileSync(CFG, V1);
    const { exitCode: code } = runRollback({ config: CFG, list: true, backupsDir: STORE, out: sink });
    expect(code).toBe(0);
    expect(text()).toContain("No backups found for this config");
  });

  it("--to <id> restores that generation's bytes", () => {
    writeFileSync(CFG, V1);
    const id = createBackup([CFG], STORE); // snapshots V1
    writeFileSync(CFG, V2); // drift away
    const { exitCode: code } = runRollback({ config: CFG, to: id, backupsDir: STORE, out: sink });
    expect(code).toBe(0);
    expect(readFileSync(CFG, "utf-8")).toBe(V1);
    expect(text()).toContain("Restored");
  });

  it("--to with an unknown id errors clearly and suggests --list", () => {
    writeFileSync(CFG, V1);
    const { exitCode: code } = runRollback({ config: CFG, to: "2020-01-01T00-00-00.000Z", backupsDir: STORE, out: sink });
    expect(code).toBe(1);
    expect(text()).toMatch(/Unknown backup id/i);
    expect(text()).toContain("--list");
  });

  it("--to warns (but still succeeds) when the generation does not include the -c config", () => {
    const other = join(DIR, "other.json");
    writeFileSync(other, V1);
    const id = createBackup([other], STORE); // snapshots other.json, NOT CFG
    writeFileSync(CFG, V2);
    const { exitCode: code } = runRollback({ config: CFG, to: id, backupsDir: STORE, out: sink });
    expect(code).toBe(0);
    expect(text()).toMatch(/does not include/i);
    // It restored the other config; CFG was never in the generation, so untouched.
    expect(readFileSync(CFG, "utf-8")).toBe(V2);
  });

  it("--to with a traversal-shaped id is rejected", () => {
    writeFileSync(CFG, V1);
    const { exitCode: code } = runRollback({ config: CFG, to: "../evil", backupsDir: STORE, out: sink });
    expect(code).toBe(1);
    expect(text()).toMatch(/Invalid backup id/i);
  });

  it("no flags restores the NEWEST store generation for this config", () => {
    writeFileSync(CFG, V1);
    createBackup([CFG], STORE); // gen 1 (V1)
    writeFileSync(CFG, V2);
    const id2 = createBackup([CFG], STORE); // gen 2 (V2), newest
    writeFileSync(CFG, JSON.stringify({ agents: { defaults: { contextTokens: 999 } } }));
    const { exitCode: code } = runRollback({ config: CFG, backupsDir: STORE, out: sink });
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
    const { exitCode: code } = runRollback({ config: CFG, backupsDir: STORE, out: sink });
    expect(code).toBe(0);
    expect(readFileSync(CFG, "utf-8")).toBe(V1);
    expect(text()).toContain("legacy sidecar");
  });

  it("prefers the newest sidecar (.pre-fix.bak over .pre-optimize.bak by mtime)", () => {
    writeFileSync(CFG, JSON.stringify({ drifted: true }));
    writeFileSync(`${CFG}.pre-optimize.bak`, V1);
    writeFileSync(`${CFG}.pre-fix.bak`, V2);
    // Set mtimes explicitly so the "newest wins" sort can't hit a same-ms tie:
    // pre-optimize is older, pre-fix is newer and must be chosen.
    const now = Date.now() / 1000;
    utimesSync(`${CFG}.pre-optimize.bak`, now - 100, now - 100);
    utimesSync(`${CFG}.pre-fix.bak`, now, now);
    const { exitCode: code } = runRollback({ config: CFG, backupsDir: STORE, out: sink });
    expect(code).toBe(0);
    expect(readFileSync(CFG, "utf-8")).toBe(V2);
  });

  it("reports when there is no store generation and no legacy sidecar", () => {
    writeFileSync(CFG, V1);
    const { exitCode: code } = runRollback({ config: CFG, backupsDir: STORE, out: sink });
    expect(code).toBe(1);
    expect(text()).toContain("No backup found");
  });

  it("--list still surfaces legacy sidecars when no store generation exists", () => {
    writeFileSync(CFG, V1);
    writeFileSync(`${CFG}.pre-fix.bak`, V2);
    const { exitCode: code } = runRollback({ config: CFG, list: true, backupsDir: STORE, out: sink });
    expect(code).toBe(0);
    expect(text()).toContain("Legacy sidecar");
  });
});

describe("runRollback — --json structured output", () => {
  it("--json --list returns structured generations + legacySidecars (and prints no text)", () => {
    writeFileSync(CFG, V1);
    const id = createBackup([CFG], STORE);
    writeFileSync(`${CFG}.pre-fix.bak`, V2); // a legacy sidecar alongside the store gen
    const { exitCode, json } = runRollback({
      config: CFG,
      list: true,
      json: true,
      backupsDir: STORE,
      out: sink,
    });
    expect(exitCode).toBe(0);
    const j = json as {
      schemaVersion: number;
      generations: Array<{ id: string; createdAt: string; files: string[] }>;
      legacySidecars: string[];
    };
    expect(j.schemaVersion).toBe(1);
    expect(j.generations).toHaveLength(1);
    expect(j.generations[0].id).toBe(id);
    expect(j.generations[0].files).toContain("openclaw.json");
    expect(typeof j.generations[0].createdAt).toBe("string");
    expect(j.legacySidecars).toContain(`${CFG}.pre-fix.bak`);
    // json mode must not touch the human sink at all.
    expect(out).toHaveLength(0);
  });

  it("--json --list returns empty arrays when nothing is found (exit 0, no note)", () => {
    writeFileSync(CFG, V1);
    const { exitCode, json } = runRollback({
      config: CFG,
      list: true,
      json: true,
      backupsDir: STORE,
      out: sink,
    });
    expect(exitCode).toBe(0);
    const j = json as { schemaVersion: number; generations: unknown[]; legacySidecars: unknown[] };
    expect(j.schemaVersion).toBe(1);
    expect(j.generations).toEqual([]);
    expect(j.legacySidecars).toEqual([]);
  });

  it("--json --to <id> returns { restored, backupId } and performs the restore", () => {
    writeFileSync(CFG, V1);
    const id = createBackup([CFG], STORE); // snapshots V1
    writeFileSync(CFG, V2); // drift away
    const { exitCode, json } = runRollback({
      config: CFG,
      to: id,
      json: true,
      backupsDir: STORE,
      out: sink,
    });
    expect(exitCode).toBe(0);
    const j = json as { schemaVersion: number; restored: string[]; backupId: string };
    expect(j.schemaVersion).toBe(1);
    expect(j.backupId).toBe(id);
    expect(j.restored).toContain(CFG);
    expect(readFileSync(CFG, "utf-8")).toBe(V1); // actually restored
    expect(out).toHaveLength(0);
  });

  it("--json --to with an unknown id returns { error: 'not-found' } and exit 1", () => {
    writeFileSync(CFG, V1);
    const { exitCode, json } = runRollback({
      config: CFG,
      to: "2020-01-01T00-00-00.000Z",
      json: true,
      backupsDir: STORE,
      out: sink,
    });
    expect(exitCode).toBe(1);
    const j = json as { schemaVersion: number; error: string; message: string };
    expect(j.schemaVersion).toBe(1);
    expect(j.error).toBe("not-found");
    expect(j.message).toMatch(/Unknown backup id/i);
  });

  it("--json --to with a traversal-shaped id returns { error: 'not-found' } and exit 1", () => {
    writeFileSync(CFG, V1);
    const { exitCode, json } = runRollback({
      config: CFG,
      to: "../evil",
      json: true,
      backupsDir: STORE,
      out: sink,
    });
    expect(exitCode).toBe(1);
    const j = json as { error: string; message: string };
    expect(j.error).toBe("not-found");
    expect(j.message).toMatch(/Invalid backup id/i);
  });

  it("--json surfaces a partial restore as { error: 'rollback-failed', inconsistent: true } exit 2", () => {
    // Same trigger as backups.test.ts: back up two files, then make the SECOND an
    // existing non-empty directory so the atomic rename onto it fails AFTER the
    // first is committed → PartialRestoreError with restored.length > 0.
    const fileA = join(DIR, "a.json");
    const fileB = join(DIR, "b.json");
    writeFileSync(fileA, "AAA");
    writeFileSync(fileB, "BBB");
    const id = createBackup([fileA, fileB], STORE);

    rmSync(fileB);
    mkdirSync(fileB);
    writeFileSync(join(fileB, "keep"), "x");
    writeFileSync(fileA, "clobbered");

    const { exitCode, json } = runRollback({
      config: fileA,
      to: id,
      json: true,
      backupsDir: STORE,
      out: sink,
    });
    expect(exitCode).toBe(2);
    const j = json as {
      schemaVersion: number;
      error: string;
      backupId: string;
      restored: string[];
      failed: string;
      inconsistent: boolean;
      message: string;
    };
    expect(j.schemaVersion).toBe(1);
    expect(j.error).toBe("rollback-failed");
    expect(j.backupId).toBe(id); // shape matches the non-partial branch + apply-plan
    expect(j.inconsistent).toBe(true);
    expect(j.restored).toContain(fileA);
    expect(j.failed).toBe(fileB);
    expect(readFileSync(fileA, "utf-8")).toBe("AAA"); // A really was restored
  });

  it("--json restore-newest (no flags) returns { restored, backupId } for the newest gen", () => {
    writeFileSync(CFG, V1);
    createBackup([CFG], STORE); // gen 1 (V1)
    writeFileSync(CFG, V2);
    const id2 = createBackup([CFG], STORE); // gen 2 (V2), newest
    writeFileSync(CFG, JSON.stringify({ agents: { defaults: { contextTokens: 999 } } }));
    const { exitCode, json } = runRollback({ config: CFG, json: true, backupsDir: STORE, out: sink });
    expect(exitCode).toBe(0);
    const j = json as { schemaVersion: number; restored: string[]; backupId: string };
    expect(j.schemaVersion).toBe(1);
    expect(j.backupId).toBe(id2);
    expect(readFileSync(CFG, "utf-8")).toBe(V2); // newest snapshot restored
  });

  it("--json no-backups (no flags, nothing present) returns a note at exit 0", () => {
    writeFileSync(CFG, V1);
    const { exitCode, json } = runRollback({ config: CFG, json: true, backupsDir: STORE, out: sink });
    expect(exitCode).toBe(0);
    const j = json as { schemaVersion: number; generations: unknown[]; legacySidecars: unknown[]; note: string };
    expect(j.schemaVersion).toBe(1);
    expect(j.generations).toEqual([]);
    expect(j.legacySidecars).toEqual([]);
    expect(j.note).toMatch(/no backups/i);
  });
});
