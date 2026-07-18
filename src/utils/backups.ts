import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { basename, dirname, extname, join, resolve } from "path";
import { homedir } from "os";
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

export function defaultBackupsDir(): string {
  return join(homedir(), ".agent-optimizer", "backups");
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
  // Two backups in the same millisecond would collide on the dir name; suffix
  // -2, -3, … until we find a free slot. Never overwrite an existing generation.
  let id = baseId;
  for (let n = 2; existsSync(join(store, id)); n++) id = `${baseId}-${n}`;

  const dir = join(store, id);
  mkdirSync(dir, { recursive: true });

  const used = new Set<string>();
  const files: Manifest["files"] = sources.map((abs) => {
    const name = uniqueName(basename(abs), used);
    copyFileSync(abs, join(dir, name));
    return { name, originalPath: abs };
  });

  const manifest: Manifest = { createdAt, files };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

  rotate(store);
  return id;
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
  // Fixed-format ISO ids sort chronologically as plain strings; reverse for
  // newest-first. A `-N` suffix sorts after its bare id — same instant, fine.
  entries.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return entries;
}

/**
 * Restore a generation's bytes back to each file's original absolute path,
 * creating parent directories as needed, and return those paths. Throws on an
 * unknown id or one that isn't a plain generation name (traversal guard).
 */
export function restoreBackup(id: string, store = defaultBackupsDir()): string[] {
  // Reject anything that could escape the store before it touches a path.
  if (id.includes("/") || id.includes("\\") || id.includes("..") || !ID_PATTERN.test(id)) {
    throw new Error(`Invalid backup id: ${id}`);
  }
  const dir = join(store, id);
  const manifest = readManifest(dir);
  if (!manifest) throw new Error(`Unknown backup id: ${id}`);
  return manifest.files.map((f) => {
    mkdirSync(dirname(f.originalPath), { recursive: true });
    copyFileSync(join(dir, f.name), f.originalPath);
    return f.originalPath;
  });
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

/** Delete the oldest generations beyond MAX_GENERATIONS. */
function rotate(store: string): void {
  for (const stale of listBackups(store).slice(MAX_GENERATIONS)) {
    rmSync(join(store, stale.id), { recursive: true, force: true });
  }
}
