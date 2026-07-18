import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  createBackup,
  listBackups,
  restoreBackup,
  defaultBackupsDir,
  PartialRestoreError,
} from "../src/utils/backups.js";

const DIR = join(process.cwd(), "__test_backups__");
const CFG = join(DIR, "openclaw.json");
const STORE = join(DIR, "store");

beforeEach(() => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(CFG, '{"v":1}');
});
afterEach(() => rmSync(DIR, { recursive: true, force: true }));

describe("backups", () => {
  it("creates a timestamped backup and lists it newest-first", () => {
    const id = createBackup([CFG], STORE);
    const all = listBackups(STORE);
    expect(all[0].id).toBe(id);
    expect(all[0].files).toContain("openclaw.json");
  });

  it("restores the exact bytes", () => {
    const id = createBackup([CFG], STORE);
    writeFileSync(CFG, '{"v":2,"broken":');
    restoreBackup(id, STORE);
    expect(readFileSync(CFG, "utf-8")).toBe('{"v":1}');
  });

  it("rotates to the newest 10 generations, keeping the most recent by creation order", () => {
    const ids: string[] = [];
    for (let i = 0; i < 13; i++) {
      writeFileSync(CFG, JSON.stringify({ gen: i })); // distinguishable per generation
      ids.push(createBackup([CFG], STORE));
    }
    const survivors = listBackups(STORE);
    expect(survivors.length).toBe(10);
    // the three oldest-created are gone; the ten newest survive, newest-first
    expect(survivors.map((e) => e.id)).toEqual(ids.slice(3).reverse());
    // bytes are intact per generation: newest holds gen 12, oldest survivor gen 3
    restoreBackup(survivors[0].id, STORE);
    expect(JSON.parse(readFileSync(CFG, "utf-8")).gen).toBe(12);
    restoreBackup(survivors[9].id, STORE);
    expect(JSON.parse(readFileSync(CFG, "utf-8")).gen).toBe(3);
  });

  // --- beyond the plan's three ---

  it("defaultBackupsDir lives under the user home", () => {
    expect(defaultBackupsDir()).toBe(join(homedir(), ".agent-optimizer", "backups"));
  });

  it("records an ISO createdAt whose colon->dash form is the id", () => {
    const id = createBackup([CFG], STORE);
    const entry = listBackups(STORE)[0];
    // valid, round-trippable ISO instant
    expect(new Date(entry.createdAt).toISOString()).toBe(entry.createdAt);
    // a lone (uncollided) backup's id is just that instant with colons swapped
    expect(entry.id).toBe(id);
    expect(id).toBe(entry.createdAt.replace(/:/g, "-"));
  });

  it("throws — and writes nothing — if any input path is missing", () => {
    expect(() => createBackup([CFG, join(DIR, "ghost.json")], STORE)).toThrow();
    expect(listBackups(STORE)).toEqual([]); // no half-written generation
  });

  it("backs up and restores two files sharing a basename from different dirs", () => {
    const dirA = join(DIR, "a");
    const dirB = join(DIR, "b");
    mkdirSync(dirA);
    mkdirSync(dirB);
    const fileA = join(dirA, "openclaw.json");
    const fileB = join(dirB, "openclaw.json");
    writeFileSync(fileA, '{"who":"a"}');
    writeFileSync(fileB, '{"who":"b"}');

    const id = createBackup([fileA, fileB], STORE);
    // clobber both originals, then restore
    writeFileSync(fileA, "corrupt-a");
    writeFileSync(fileB, "corrupt-b");
    const restored = restoreBackup(id, STORE);

    expect(restored).toContain(fileA);
    expect(restored).toContain(fileB);
    expect(readFileSync(fileA, "utf-8")).toBe('{"who":"a"}');
    expect(readFileSync(fileB, "utf-8")).toBe('{"who":"b"}');

    // both absolute originals are recoverable from the listing
    const entry = listBackups(STORE)[0];
    expect(entry.originalPaths).toContain(fileA);
    expect(entry.originalPaths).toContain(fileB);
  });

  it("restoreBackup throws on an unknown id", () => {
    expect(() => restoreBackup("2026-07-18T00-00-00.000Z", STORE)).toThrow();
  });

  it("restoreBackup rejects path-traversal ids before touching the store", () => {
    expect(() => restoreBackup("../x", STORE)).toThrow();
    expect(() => restoreBackup("..", STORE)).toThrow();
    expect(() => restoreBackup("a/b", STORE)).toThrow();
  });

  it("listBackups returns [] when the store does not exist", () => {
    expect(listBackups(join(DIR, "does-not-exist"))).toEqual([]);
  });

  it("skips corrupt entries instead of crashing", () => {
    createBackup([CFG], STORE);
    // a stray dir with a broken manifest must not break listing
    const bogus = join(STORE, "2026-01-01T00-00-00.000Z");
    mkdirSync(bogus, { recursive: true });
    writeFileSync(join(bogus, "manifest.json"), "{not json");
    const all = listBackups(STORE);
    expect(all.length).toBe(1);
    expect(all[0].files).toContain("openclaw.json");
  });

  it("preflights missing stored blobs and touches nothing", () => {
    const id = createBackup([CFG], STORE);
    rmSync(join(STORE, id, "openclaw.json")); // backup is now incomplete
    writeFileSync(CFG, "LIVE");
    expect(() => restoreBackup(id, STORE)).toThrow(/missing stored file/i);
    expect(readFileSync(CFG, "utf-8")).toBe("LIVE"); // original untouched
    expect(existsSync(CFG + ".restore.tmp")).toBe(false); // no staging residue
  });

  it("throws PartialRestoreError carrying restored/failed/cause on a mid-restore failure", () => {
    const fileA = join(DIR, "a.json");
    const fileB = join(DIR, "b.json");
    writeFileSync(fileA, "AAA");
    writeFileSync(fileB, "BBB");
    const id = createBackup([fileA, fileB], STORE);

    // Make B's path an existing non-empty directory so the atomic rename onto it
    // fails — after A has already been committed. Clobber A to prove it restores.
    rmSync(fileB);
    mkdirSync(fileB);
    writeFileSync(join(fileB, "keep"), "x");
    writeFileSync(fileA, "clobbered");

    let err: unknown;
    try {
      restoreBackup(id, STORE);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PartialRestoreError);
    const pe = err as PartialRestoreError;
    expect(pe.restored).toContain(fileA); // A committed before B failed
    expect(pe.failed).toBe(fileB);
    expect(pe.cause).toBeDefined();
    expect(readFileSync(fileA, "utf-8")).toBe("AAA"); // A really was restored
    // no staging residue left behind for either file
    expect(existsSync(fileA + ".restore.tmp")).toBe(false);
    expect(existsSync(fileB + ".restore.tmp")).toBe(false);
  });

  it("sweeps manifest-less crash leftovers on the next backup", () => {
    // mkdir ran but the manifest write never landed (crash window)
    const leftover = join(STORE, "2026-01-02T03-04-05.678Z");
    mkdirSync(leftover, { recursive: true });
    writeFileSync(join(leftover, "openclaw.json"), "orphaned blob");
    expect(existsSync(leftover)).toBe(true);

    createBackup([CFG], STORE); // rotate() sweeps the orphan
    expect(existsSync(leftover)).toBe(false);
    expect(listBackups(STORE).length).toBe(1); // the real backup is unaffected
  });
});
