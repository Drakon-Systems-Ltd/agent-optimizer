import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  createBackup,
  listBackups,
  restoreBackup,
  defaultBackupsDir,
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

  it("rotates to the newest 10 generations", () => {
    for (let i = 0; i < 13; i++) createBackup([CFG], STORE);
    expect(listBackups(STORE).length).toBe(10);
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
});
