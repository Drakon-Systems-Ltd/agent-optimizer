import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from "fs";
import { join } from "path";
import { listBackups } from "../src/utils/backups.js";
import {
  transactionalApply,
  ApplyLockedError,
  ApplyPreconditionError,
  ApplyRolledBackError,
  RollbackFailedError,
} from "../src/utils/transactional.js";

const DIR = join(process.cwd(), "__test_transactional__");
const CFG = join(DIR, "openclaw.json");
const CFG2 = join(DIR, "openclaw2.json");
const STORE = join(DIR, "store");
// Default lockDir derives to join(dirname(resolve(STORE)), "apply.lock") = DIR/apply.lock.
const LOCK = join(DIR, "apply.lock");

// A valid primary is REQUIRED or model-config early-returns and masks every check.
const VALID = {
  agents: {
    defaults: {
      model: { primary: "anthropic/claude-opus-4-8", fallbacks: ["openai/gpt-5.6"] },
      contextTokens: 1000000,
    },
  },
};

function writeValid(): string {
  const bytes = JSON.stringify(VALID);
  writeFileSync(CFG, bytes);
  return bytes;
}

beforeEach(() => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
});
afterEach(() => rmSync(DIR, { recursive: true, force: true }));

describe("transactionalApply", () => {
  it("applies and keeps the change when verification passes", () => {
    writeValid();
    const result = transactionalApply({
      files: [CFG],
      backupsDir: STORE,
      mutate: () => {
        const cfg = JSON.parse(readFileSync(CFG, "utf-8"));
        cfg.agents.defaults.contextTokens = 200000;
        writeFileSync(CFG, JSON.stringify(cfg));
      },
    });
    expect(result.rolledBack).toBe(false);
    expect(result.verified).toBe(true);
    expect(result.backupId).toBeTruthy();
    expect(JSON.parse(readFileSync(CFG, "utf-8")).agents.defaults.contextTokens).toBe(200000);
  });

  it("auto-rolls back and restores original bytes when the mutation corrupts the config", () => {
    const original = writeValid();
    let err: unknown;
    try {
      transactionalApply({
        files: [CFG],
        backupsDir: STORE,
        mutate: () => writeFileSync(CFG, "{corrupt"),
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApplyRolledBackError);
    const rolled = err as ApplyRolledBackError;
    expect(rolled.reasons.length).toBeGreaterThan(0);
    expect(rolled.backupId).toBeTruthy();
    expect(readFileSync(CFG, "utf-8")).toBe(original);
  });

  it("auto-rolls back when the mutation introduces a new fail while staying parseable", () => {
    const original = writeValid();
    let err: unknown;
    try {
      transactionalApply({
        files: [CFG],
        backupsDir: STORE,
        mutate: () => {
          const cfg = JSON.parse(readFileSync(CFG, "utf-8"));
          cfg.agents.defaults.thinkingDefault = "nope"; // a real fail, parseable
          writeFileSync(CFG, JSON.stringify(cfg));
        },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApplyRolledBackError);
    expect((err as ApplyRolledBackError).reasons.length).toBeGreaterThan(0);
    expect(readFileSync(CFG, "utf-8")).toBe(original);
  });

  it("refuses when a fresh lock is already held", () => {
    const original = writeValid();
    mkdirSync(LOCK, { recursive: true });
    writeFileSync(join(LOCK, "lock.json"), JSON.stringify({ pid: 999999, startedAt: Date.now() }));
    let mutated = false;
    let err: unknown;
    try {
      transactionalApply({
        files: [CFG],
        backupsDir: STORE,
        mutate: () => {
          mutated = true;
          writeFileSync(CFG, "{corrupt");
        },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApplyLockedError);
    expect((err as Error).message).toMatch(/another apply/i);
    expect(mutated).toBe(false);
    expect(readFileSync(CFG, "utf-8")).toBe(original);
    expect(listBackups(STORE)).toHaveLength(0);
  });

  it("reclaims a stale lock and proceeds", () => {
    writeValid();
    mkdirSync(LOCK, { recursive: true });
    writeFileSync(
      join(LOCK, "lock.json"),
      JSON.stringify({ pid: 999999, startedAt: Date.now() - 20 * 60 * 1000 })
    );
    const result = transactionalApply({
      files: [CFG],
      backupsDir: STORE,
      mutate: () => {
        const cfg = JSON.parse(readFileSync(CFG, "utf-8"));
        cfg.agents.defaults.contextTokens = 200000;
        writeFileSync(CFG, JSON.stringify(cfg));
      },
    });
    expect(result.verified).toBe(true);
    expect(JSON.parse(readFileSync(CFG, "utf-8")).agents.defaults.contextTokens).toBe(200000);
  });

  it("rolls back when the mutation throws", () => {
    const original = writeValid();
    let err: unknown;
    try {
      transactionalApply({
        files: [CFG],
        backupsDir: STORE,
        mutate: () => {
          throw new Error("boom during mutate");
        },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApplyRolledBackError);
    expect((err as ApplyRolledBackError).reasons.some((r) => /mutation threw/.test(r))).toBe(true);
    expect(readFileSync(CFG, "utf-8")).toBe(original);
  });

  it("refuses (precondition) and touches nothing when the pre-state is unparseable", () => {
    writeFileSync(CFG, "{broken");
    const before = readFileSync(CFG, "utf-8");
    let mutated = false;
    let err: unknown;
    try {
      transactionalApply({
        files: [CFG],
        backupsDir: STORE,
        mutate: () => {
          mutated = true;
        },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApplyPreconditionError);
    expect(mutated).toBe(false);
    expect(readFileSync(CFG, "utf-8")).toBe(before);
    expect(listBackups(STORE)).toHaveLength(0);
  });

  it("releases the lock on the rollback path so a later apply succeeds", () => {
    writeValid();
    // First apply corrupts → rolls back → must release the lock in finally.
    expect(() =>
      transactionalApply({
        files: [CFG],
        backupsDir: STORE,
        mutate: () => writeFileSync(CFG, "{corrupt"),
      })
    ).toThrow(ApplyRolledBackError);

    // Second apply on a fresh valid config must acquire the (released) lock.
    writeValid();
    const result = transactionalApply({
      files: [CFG],
      backupsDir: STORE,
      mutate: () => {
        const cfg = JSON.parse(readFileSync(CFG, "utf-8"));
        cfg.agents.defaults.contextTokens = 200000;
        writeFileSync(CFG, JSON.stringify(cfg));
      },
    });
    expect(result.verified).toBe(true);
    expect(existsSync(LOCK)).toBe(false); // lock released again
  });

  it("surfaces RollbackFailedError with an inconsistent (partial) restore", () => {
    // Two files backed up. The mutation corrupts CFG (so verify fails and triggers
    // rollback) and turns CFG2 into a non-empty DIRECTORY. During rollback,
    // restoreBackup stages both, commits CFG (rename succeeds → restored=[CFG]),
    // then rename(tmp → CFG2) fails because CFG2 is now a directory → the restore
    // throws PartialRestoreError with restored.length > 0 (INCONSISTENT disk).
    writeValid();
    writeFileSync(CFG2, "{}");
    let err: unknown;
    try {
      transactionalApply({
        files: [CFG, CFG2],
        backupsDir: STORE,
        mutate: () => {
          writeFileSync(CFG, "{corrupt");
          rmSync(CFG2, { force: true });
          mkdirSync(CFG2, { recursive: true });
          writeFileSync(join(CFG2, "blocker"), "x"); // non-empty ⇒ rename can't clobber
        },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RollbackFailedError);
    const rf = err as RollbackFailedError;
    expect(rf.backupId).toBeTruthy();
    expect(rf.reasons.length).toBeGreaterThan(0);
    expect(rf.failed).toBe(CFG2);
    expect(rf.restored.length).toBeGreaterThan(0);
    expect(rf.restored).toContain(CFG);
    expect(rf.message).toMatch(/inconsistent/i);
    // CFG was reverted; CFG2 was NOT — the inconsistency this error warns about.
    expect(readFileSync(CFG, "utf-8")).toBe(JSON.stringify(VALID));
  });

  it("maps a missing target file to ApplyPreconditionError, touching nothing", () => {
    const original = writeValid();
    const missing = join(DIR, "nope.json");
    let mutated = false;
    let err: unknown;
    try {
      transactionalApply({
        files: [CFG, missing], // CFG parses (finite baseline) but CFG2 is absent
        backupsDir: STORE,
        mutate: () => {
          mutated = true;
        },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApplyPreconditionError);
    expect(mutated).toBe(false);
    expect(readFileSync(CFG, "utf-8")).toBe(original);
    expect(listBackups(STORE)).toHaveLength(0);
  });

  it("surfaces RollbackFailedError (restored: [], failed: '') when the restore cannot even begin", () => {
    writeValid();
    let err: unknown;
    try {
      transactionalApply({
        files: [CFG],
        backupsDir: STORE,
        mutate: () => {
          // Corrupt CFG so verification fails and a rollback is attempted...
          writeFileSync(CFG, "{corrupt");
          // ...then delete the stored blob so restoreBackup's PREFLIGHT throws a
          // plain Error (missing stored file) — NOT a PartialRestoreError. Nothing
          // is committed back, so restored stays empty.
          const gen = readdirSync(STORE)[0];
          rmSync(join(STORE, gen, "openclaw.json"), { force: true });
        },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RollbackFailedError);
    const rf = err as RollbackFailedError;
    expect(rf.restored).toEqual([]);
    expect(rf.failed).toBe("");
    expect(rf.reasons.length).toBeGreaterThan(0);
    expect(rf.message.length).toBeGreaterThan(0);
  });

  it("rejects an empty files list with a clear (non-precondition) error before any lock/backup", () => {
    let err: unknown;
    try {
      transactionalApply({
        files: [],
        backupsDir: STORE,
        mutate: () => {},
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ApplyPreconditionError);
    expect((err as Error).message).toMatch(/at least one file/i);
    expect(existsSync(LOCK)).toBe(false); // never acquired the lock
  });
});
