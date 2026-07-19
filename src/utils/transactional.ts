import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  createBackup,
  defaultBackupsDir,
  PartialRestoreError,
  restoreBackup,
} from "./backups.js";
import { countFails, verifyConfigFile } from "./apply-verify.js";

/**
 * Transactional apply engine: backup → mutate → verify → auto-rollback.
 *
 * This is the safety net for every edit the agent loop makes to a live
 * OpenClaw config. A mutation that would break the config (fail to parse, or
 * regress the auditors above the pre-apply baseline) is reverted to the exact
 * pre-apply bytes before the error propagates, so a bad apply can never leave
 * the gateway in a broken state.
 *
 * A directory-based lockfile serializes ALL applies. Beyond preventing two
 * concurrent applies from interleaving, that serialization is what makes the
 * Task 4 backup rotation/sweep concurrency-safe — only one apply is ever
 * touching the backups store at a time.
 */
export interface TransactionalApplyOptions {
  /** Config files to snapshot + verify. files[0] is the primary config that
   *  gets the baseline capture and the post-mutation verification. */
  files: string[];
  /** Performs the in-place edit(s). May throw — a throw triggers rollback. */
  mutate: () => void;
  /** Backups store; defaults to defaultBackupsDir(). Injectable for tests. */
  backupsDir?: string;
  /** Lock directory; defaults to a sibling of backupsDir. Injectable for tests. */
  lockDir?: string;
  /** A held lock older than this (ms) is considered abandoned and reclaimed. */
  staleLockMs?: number;
}

export interface ApplyResult {
  rolledBack: false;
  backupId: string;
  verified: true;
}

/** Another apply holds the lock and it is not stale — refuse rather than race. */
export class ApplyLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplyLockedError";
  }
}

/** The apply cannot safely begin — either the pre-apply config is unusable
 *  (non-finite baseline) or the target files could not be snapshotted. In all
 *  cases the originals are untouched and mutate has not run. */
export class ApplyPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplyPreconditionError";
  }
}

/** The mutation produced a bad config (verify failed OR mutate threw) and the
 *  rollback SUCCEEDED — the disk is back to its exact pre-apply bytes. */
export class ApplyRolledBackError extends Error {
  readonly reasons: string[];
  readonly backupId: string;
  constructor(message: string, opts: { reasons: string[]; backupId: string }) {
    super(message);
    this.name = "ApplyRolledBackError";
    this.reasons = opts.reasons;
    this.backupId = opts.backupId;
  }
}

/** DOUBLE failure: the mutation was bad AND the rollback itself failed. When
 *  `restored.length > 0`, some originals were reverted and at least one was not,
 *  so the disk is INCONSISTENT and needs manual attention. */
export class RollbackFailedError extends Error {
  readonly reasons: string[];
  readonly backupId: string;
  readonly restored: string[];
  /** The path the restore choked on when a partial restore identified one; ""
   *  when the failure was not file-specific (the detail is then in .message). */
  readonly failed: string;
  constructor(
    message: string,
    opts: { reasons: string[]; backupId: string; restored: string[]; failed: string }
  ) {
    super(message);
    this.name = "RollbackFailedError";
    this.reasons = opts.reasons;
    this.backupId = opts.backupId;
    this.restored = opts.restored;
    this.failed = opts.failed;
  }
}

const DEFAULT_STALE_LOCK_MS = 10 * 60 * 1000;

interface LockMeta {
  pid: number;
  startedAt: number;
}

/** Age (ms) of the lock currently at lockDir, from its lock.json startedAt, or
 *  the dir's mtime if that is unreadable. A vanished dir reads as infinitely
 *  old so the caller reclaims it. */
function lockAgeMs(lockDir: string, now: number): number {
  try {
    const raw = readFileSync(join(lockDir, "lock.json"), "utf-8");
    const parsed = JSON.parse(raw) as Partial<LockMeta>;
    if (typeof parsed.startedAt === "number") return now - parsed.startedAt;
  } catch {
    // fall through to the dir mtime
  }
  try {
    return now - statSync(lockDir).mtimeMs;
  } catch {
    return Infinity; // dir gone — treat as stale so we retry the mkdir
  }
}

/**
 * Acquire the apply lock via an atomic, non-recursive mkdir. A non-recursive
 * mkdir throws EEXIST when the directory already exists, which is exactly the
 * test-and-set primitive we need — {recursive:true} would silently succeed and
 * defeat the lock. On EEXIST we reclaim the lock only if it is older than
 * staleLockMs; otherwise we refuse.
 */
function acquireLock(lockDir: string, staleLockMs: number): void {
  mkdirSync(dirname(lockDir), { recursive: true });
  try {
    mkdirSync(lockDir); // non-recursive: throws EEXIST if already held
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    if (lockAgeMs(lockDir, Date.now()) <= staleLockMs) {
      throw new ApplyLockedError(
        "another apply is already in progress (lock held) — refusing to run concurrently"
      );
    }
    // Stale: reclaim it. rmSync then a single retry of the atomic mkdir; if the
    // retry still collides, another apply just won the race — refuse.
    rmSync(lockDir, { recursive: true, force: true });
    try {
      mkdirSync(lockDir);
    } catch (e2) {
      if ((e2 as NodeJS.ErrnoException).code === "EEXIST") {
        throw new ApplyLockedError(
          "another apply is already in progress (lock reclaimed then re-taken) — refusing to run concurrently"
        );
      }
      throw e2;
    }
  }
  // We now own the lock dir. Stamp it — but if that write fails, release the dir
  // we just created so a failed stamp can't leak the lock. This cleanup stays
  // INSIDE acquireLock (we own the dir only here); the outer finally must not
  // handle it, because that finally also runs on the ApplyLockedError path where
  // we do NOT own the lock.
  try {
    writeFileSync(
      join(lockDir, "lock.json"),
      JSON.stringify({ pid: process.pid, startedAt: Date.now() } satisfies LockMeta)
    );
  } catch (e) {
    rmSync(lockDir, { recursive: true, force: true });
    throw e;
  }
}

/** Restore the backup and, whatever the outcome, throw the right typed error.
 *  Never returns normally — either ApplyRolledBackError (clean) or
 *  RollbackFailedError (double failure). */
function rollbackAndThrow(reasons: string[], backupId: string, backupsDir: string): never {
  try {
    restoreBackup(backupId, backupsDir);
  } catch (e) {
    if (e instanceof PartialRestoreError) {
      const inconsistent = e.restored.length > 0;
      const msg = inconsistent
        ? `ROLLBACK FAILED — disk is INCONSISTENT: ${e.restored.length} file(s) were reverted but "${e.failed}" was not. Manual repair required. (rolling back because: ${reasons[0] ?? "unknown"})`
        : `Rollback failed while staging the restore at "${e.failed}" — no original was overwritten, so files remain in the mutated state. (rolling back because: ${reasons[0] ?? "unknown"})`;
      throw new RollbackFailedError(msg, {
        reasons,
        backupId,
        restored: e.restored,
        failed: e.failed,
      });
    }
    // Preflight / non-partial failure: restore threw before committing anything,
    // so nothing was reverted (restored: []) and no single path is to blame
    // (failed: "" — the detail is in .message).
    throw new RollbackFailedError(
      `Rollback failed before any original was restored: ${(e as Error).message}. Files remain in the mutated state. (rolling back because: ${reasons[0] ?? "unknown"})`,
      { reasons, backupId, restored: [], failed: "" }
    );
  }
  throw new ApplyRolledBackError(
    `Apply rolled back — the change would break the config: ${reasons[0] ?? "verification failed"}`,
    { reasons, backupId }
  );
}

/**
 * Run a mutation transactionally: snapshot, mutate, verify, and auto-rollback on
 * failure. Returns on success; throws a typed error on every failure path.
 *
 * Throws:
 *  - ApplyLockedError      — another apply holds a live lock
 *  - ApplyPreconditionError— the pre-apply config is already unusable
 *  - ApplyRolledBackError  — mutation was bad, rollback succeeded (disk clean)
 *  - RollbackFailedError   — mutation was bad AND rollback failed (disk maybe dirty)
 */
export function transactionalApply(opts: TransactionalApplyOptions): ApplyResult {
  // Guard BEFORE the lock/backup: files[0] drives the baseline and verify, so an
  // empty list is caller misuse — fail with a clear message rather than letting
  // countFails(undefined) collapse into a confusing ApplyPreconditionError.
  if (opts.files.length === 0) {
    throw new Error("transactionalApply requires at least one file in `files`");
  }

  const backupsDir = opts.backupsDir ?? defaultBackupsDir();
  const lockDir = opts.lockDir ?? join(dirname(resolve(backupsDir)), "apply.lock");
  const staleLockMs = opts.staleLockMs ?? DEFAULT_STALE_LOCK_MS;

  // Acquire OUTSIDE the try/finally on purpose: if acquire throws ApplyLockedError
  // we do NOT own the lock, and the finally below (which rmSync's lockDir) must
  // not run — it would delete the current holder's lock and break their apply.
  // Only once acquireLock returns do we own the dir and take on its release.
  // Design assumption: an apply completes in well under staleLockMs (sub-second
  // vs the 10-minute default), so unconditionally releasing in the finally is
  // safe — we cannot plausibly be releasing a lock a later apply has reclaimed.
  // If that ever stopped holding, an owner-token (stamp a nonce, verify it before
  // rmSync) would close the residual TOCTOU; unnecessary at current durations.
  acquireLock(lockDir, staleLockMs);
  try {
    // (a) Refuse up front if the pre-apply config is already broken. A non-finite
    // baseline means countFails could not trust the pre-state (parse error,
    // missing, non-object) — do NOT back up or mutate a config we can't verify
    // against. This runs BEFORE any backup or mutation.
    const baseline = countFails(opts.files[0]);
    if (!Number.isFinite(baseline)) {
      throw new ApplyPreconditionError(
        `Refusing to apply: the pre-apply config "${opts.files[0]}" is already unusable (cannot compute a baseline). Fix its parse error before applying.`
      );
    }

    // (b) Snapshot every file so we can revert to exact bytes. createBackup
    // existence-checks every input BEFORE writing anything and never touches an
    // original, so a missing file aborts with no partial generation and the disk
    // untouched — semantically a precondition failure (e.g. an agent pointed at a
    // nonexistent path). Map it into the taxonomy instead of leaking a bare Error,
    // which Task 7's consumers would not recognize.
    let backupId: string;
    try {
      backupId = createBackup(opts.files, backupsDir);
    } catch (e) {
      throw new ApplyPreconditionError(
        `Refusing to apply: could not snapshot the target files — ${(e as Error).message}`
      );
    }

    // (c) Mutate, then verify. Either can trigger rollback.
    try {
      opts.mutate();
    } catch (e) {
      rollbackAndThrow([`mutation threw: ${(e as Error).message}`], backupId, backupsDir);
    }

    const v = verifyConfigFile(opts.files[0], { baselineFails: baseline });
    if (!v.ok) {
      rollbackAndThrow(v.reasons, backupId, backupsDir);
    }

    // (d) Success — keep the change.
    return { rolledBack: false, backupId, verified: true };
  } finally {
    // Release the lock on EVERY exit path (success, rollback, precondition,
    // rollback-failure). A leaked lock would block all future applies.
    rmSync(lockDir, { recursive: true, force: true });
  }
}
