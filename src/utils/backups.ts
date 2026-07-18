import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { basename, dirname, extname, join, resolve } from "path";
import { agentOptimizerHome } from "./paths.js";
import { expandPath } from "./config.js";

/** Newest N generations kept; createBackup prunes the rest after each write. */
const MAX_GENERATIONS = 10;

/**
 * A backup id is an ISO timestamp with colons swapped for dashes, optionally
 * carrying a `-N` collision suffix. The class allows `.` (for the millisecond
 * fraction), so `..` slips through it — restoreBackup rejects that separately.
 */
const ID_PATTERN = /^[0-9T.\-Z]+(-\d+)?$/;

interface Manifest {
  createdAt: string;
  files: { name: string; originalPath: string }[];
}

export interface BackupEntry {
  id: string;
  createdAt: string;       // ISO instant the backup was taken
  files: string[];         // original basenames, for display
  originalPaths: string[]; // absolute paths the bytes restore to
}

/**
 * Thrown when a restore fails after it has begun committing files. Carries the
 * paths already written (`restored`), the path it broke on (`failed`), and the
 * underlying error (`cause`) so a caller (e.g. transactionalApply) can fold it
 * into its own rollback reporting rather than seeing a bare fs error.
 */
export class PartialRestoreError extends Error {
  readonly restored: string[];
  readonly failed: string;
  constructor(restored: string[], failed: string, cause: unknown) {
    super(`Restore failed at ${failed} after restoring ${restored.length} file(s)`, { cause });
    this.name = "PartialRestoreError";
    this.restored = restored;
    this.failed = failed;
  }
}

export function defaultBackupsDir(): string {
  return join(agentOptimizerHome(), "backups");
}

/**
 * Snapshot the given files into a new generation under `store` and return its
 * id. Every input is existence-checked before anything is written, so a missing
 * file aborts the whole call rather than leaving a partial generation behind.
 * Throws if any path is missing.
 */
export function createBackup(paths: string[], store = defaultBackupsDir()): string {
  const sources = paths.map((p) => {
    const abs = resolve(expandPath(p));
    if (!existsSync(abs)) throw new Error(`Cannot back up missing file: ${p}`);
    return abs;
  });

  const createdAt = new Date().toISOString();
  const baseId = createdAt.replace(/:/g, "-"); // only the time part has colons
  const id = nextGenerationId(store, baseId);

  const dir = join(store, id);
  mkdirSync(dir, { recursive: true });

  const used = new Set<string>();
  const files: Manifest["files"] = sources.map((abs) => {
    const name = uniqueName(basename(abs), used);
    copyFileSync(abs, join(dir, name));
    return { name, originalPath: abs };
  });

  // Atomic manifest write: a crash mid-write can't leave a truncated manifest;
  // rotate() also sweeps any dir whose manifest never landed at all.
  const manifest: Manifest = { createdAt, files };
  const manifestPath = join(dir, "manifest.json");
  const manifestTmp = join(dir, ".manifest.json.tmp");
  writeFileSync(manifestTmp, JSON.stringify(manifest, null, 2));
  renameSync(manifestTmp, manifestPath);

  rotate(store);
  return id;
}

/**
 * Pick an unused generation id for `baseId`. When the millisecond is already
 * taken, allocate a suffix strictly above every existing sibling (bare id = 1)
 * so ids stay monotonic with creation order — even after rotation frees a low
 * slot, we never reuse it, which keeps the just-written backup the newest.
 */
function nextGenerationId(store: string, baseId: string): string {
  if (!existsSync(store)) return baseId;
  let max = 0;
  for (const name of readdirSync(store)) {
    if (name === baseId) {
      max = Math.max(max, 1);
    } else if (name.startsWith(`${baseId}-`)) {
      const n = Number(name.slice(baseId.length + 1));
      if (Number.isInteger(n)) max = Math.max(max, n);
    }
  }
  return max === 0 ? baseId : `${baseId}-${max + 1}`;
}

/** Distinct name within one flat backup dir: inputs from different directories
 * can share a basename, so collisions get an -N before the extension. */
function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  if (used.has(name)) {
    const ext = extname(base);
    const stem = base.slice(0, base.length - ext.length);
    for (let n = 2; used.has(name); n++) name = `${stem}-${n}${ext}`;
  }
  used.add(name);
  return name;
}

/** All generations in `store`, newest-first. Missing store → []. Dirs without a
 * valid manifest are skipped rather than throwing. */
export function listBackups(store = defaultBackupsDir()): BackupEntry[] {
  if (!existsSync(store)) return [];
  const entries: BackupEntry[] = [];
  for (const dirent of readdirSync(store, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const manifest = readManifest(join(store, dirent.name));
    if (!manifest) continue;
    entries.push({
      id: dirent.name,
      createdAt: manifest.createdAt,
      files: manifest.files.map((f) => basename(f.originalPath)),
      originalPaths: manifest.files.map((f) => f.originalPath),
    });
  }
  // Newest-first by creation instant; within one millisecond, the higher
  // collision suffix (bare id = 1) is the later write, so it sorts first.
  entries.sort((a, b) =>
    a.createdAt !== b.createdAt
      ? (a.createdAt < b.createdAt ? 1 : -1)
      : idSuffix(b.id) - idSuffix(a.id)
  );
  return entries;
}

/** Collision suffix number of an id; a bare (unsuffixed) id counts as 1. */
function idSuffix(id: string): number {
  const m = /-(\d+)$/.exec(id);
  return m ? Number(m[1]) : 1;
}

/**
 * Restore a generation's bytes back to each file's original absolute path and
 * return those paths. Two phases — stage every file beside its target, then
 * commit them all with atomic renames — so a mid-restore failure can't leave
 * mixed state. Throws Error on an unknown id, a bad id (traversal guard), or a
 * missing stored blob; throws PartialRestoreError if a commit fails part-way.
 */
export function restoreBackup(id: string, store = defaultBackupsDir()): string[] {
  // Reject anything that could escape the store before it touches a path.
  if (id.includes("/") || id.includes("\\") || id.includes("..") || !ID_PATTERN.test(id)) {
    throw new Error(`Invalid backup id: ${id}`);
  }
  const dir = join(store, id);
  const manifest = readManifest(dir);
  if (!manifest) throw new Error(`Unknown backup id: ${id}`);

  // Preflight: every stored blob must exist before we disturb any original.
  for (const f of manifest.files) {
    if (!existsSync(join(dir, f.name))) {
      throw new Error(`Backup ${id} is missing stored file "${f.name}" — cannot restore`);
    }
  }

  const staged: { tmp: string; originalPath: string }[] = [];
  const restored: string[] = [];
  let current = "";
  try {
    for (const f of manifest.files) {
      // originalPath is a trusted absolute write target from the user-owned
      // manifest; the id guard above covers the only untrusted input (the id).
      current = f.originalPath;
      mkdirSync(dirname(f.originalPath), { recursive: true });
      const tmp = `${f.originalPath}.restore.tmp`;
      copyFileSync(join(dir, f.name), tmp);
      staged.push({ tmp, originalPath: f.originalPath });
    }
    for (const s of staged) {
      current = s.originalPath;
      renameSync(s.tmp, s.originalPath); // atomic on the same filesystem
      restored.push(s.originalPath);
    }
  } catch (cause) {
    // Drop any temp file not yet committed; already-renamed originals are whole
    // and stay in place. Report where it broke for the caller's rollback.
    for (const s of staged) {
      if (!restored.includes(s.originalPath)) rmSync(s.tmp, { force: true });
    }
    throw new PartialRestoreError(restored, current, cause);
  }
  return restored;
}

function readManifest(dir: string): Manifest | null {
  const file = join(dir, "manifest.json");
  if (!existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
    return isManifest(parsed) ? parsed : null;
  } catch {
    return null; // unreadable / unparseable — treat as not-a-backup
  }
}

function isManifest(v: unknown): v is Manifest {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  if (typeof m.createdAt !== "string" || !Array.isArray(m.files)) return false;
  return m.files.every((f) => {
    if (!f || typeof f !== "object") return false;
    const entry = f as Record<string, unknown>;
    return typeof entry.name === "string" && typeof entry.originalPath === "string";
  });
}

/**
 * Prune the oldest generations beyond MAX_GENERATIONS, then sweep any
 * backup-shaped dir that has no manifest — a crash between mkdir and the
 * manifest write leaves one behind, and listBackups ignores it, so without this
 * it would accumulate invisibly.
 */
function rotate(store: string): void {
  const valid = listBackups(store);
  for (const stale of valid.slice(MAX_GENERATIONS)) {
    rmSync(join(store, stale.id), { recursive: true, force: true });
  }
  const validIds = new Set(valid.map((e) => e.id));
  for (const dirent of readdirSync(store, { withFileTypes: true })) {
    if (!dirent.isDirectory() || validIds.has(dirent.name)) continue;
    if (!ID_PATTERN.test(dirent.name)) continue; // only touch backup-shaped names
    if (!existsSync(join(store, dirent.name, "manifest.json"))) {
      rmSync(join(store, dirent.name), { recursive: true, force: true });
    }
  }
}
