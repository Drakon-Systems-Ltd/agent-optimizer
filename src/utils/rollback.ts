import chalk from "chalk";
import { copyFileSync, existsSync, readFileSync, statSync } from "fs";
import { basename, join, resolve } from "path";
import {
  defaultBackupsDir,
  listBackups,
  PartialRestoreError,
  restoreBackup,
} from "./backups.js";
import { expandPath, loadConfig, findAgentDir } from "./config.js";

export interface RollbackOptions {
  /** -c path — may contain ~ or be relative. */
  config: string;
  /** --list: enumerate the generations touching this config. */
  list?: boolean;
  /** --to <id>: restore a specific generation by id. */
  to?: string;
  /** --json: build a structured result instead of printing human text. */
  json?: boolean;
  /** Test-only injection; defaults to defaultBackupsDir(). */
  backupsDir?: string;
  /** Sink for human output; defaults to console.log. Unused in json mode. */
  out?: (msg: string) => void;
}

/**
 * The outcome of a rollback. `exitCode` is what the process should adopt (0
 * success / informational, 1 plain error, 2 partial restore — disk INCONSISTENT).
 * `json` is present ONLY in json mode: the structured object the CLI prints on
 * stdout. In text mode the human output has already gone to `out` and `json` is
 * undefined.
 */
export interface RollbackResult {
  exitCode: number;
  json?: unknown;
}

const RESTART = "  Restart the gateway to apply: systemctl --user restart openclaw-gateway";

// Pre-0.13.0 sidecar backups, newest-intent first (audit --fix wrote .pre-fix.bak,
// optimize wrote .pre-optimize.bak). One source so the legacy-path builders agree.
const SIDECAR_SUFFIXES = [".pre-fix.bak", ".pre-optimize.bak"] as const;
const sidecarPaths = (configPath: string): string[] =>
  SIDECAR_SUFFIXES.map((s) => `${configPath}${s}`);

/**
 * Restore an OpenClaw config (and any co-snapshotted files) from the backup
 * store, with a fallback to the pre-0.13.0 `.pre-optimize.bak` / `.pre-fix.bak`
 * sidecars so backups written by older versions still restore.
 *
 * Returns the process exit code (0 on success / informational listing, 1 on a
 * plain error, 2 on a partial restore — disk INCONSISTENT) and, in json mode,
 * the structured object to print on stdout. In text mode the human output has
 * already gone to `out`; in json mode nothing is printed and `json` is set.
 */
export function runRollback(opts: RollbackOptions): RollbackResult {
  const out = opts.out ?? console.log;
  const json = !!opts.json;
  const store = opts.backupsDir ?? defaultBackupsDir();
  const configPath = resolve(expandPath(opts.config));

  // Store generations whose manifest restores THIS config, newest-first.
  const generations = () =>
    listBackups(store).filter((b) => b.originalPaths.includes(configPath));
  const legacySidecars = () => sidecarPaths(configPath).filter((p) => existsSync(p));

  // ── --list ──────────────────────────────────────────────────────────────
  if (opts.list) {
    const gens = generations();
    const legacy = legacySidecars();
    if (json) {
      // Structured listing: empty arrays when nothing is found (no "note" — this
      // is the read-only enumeration verb, not a failed restore).
      return {
        exitCode: 0,
        json: {
          schemaVersion: 1,
          generations: gens.map((g) => ({ id: g.id, createdAt: g.createdAt, files: g.files })),
          legacySidecars: legacy,
        },
      };
    }
    if (gens.length === 0 && legacy.length === 0) {
      out(chalk.yellow("  No backups found for this config."));
      out(chalk.dim(`  Config: ${configPath}`));
      out(chalk.dim("  Backups are created by: agent-optimizer optimize  /  agent-optimizer audit --fix"));
      return { exitCode: 0 };
    }
    if (gens.length > 0) {
      out(chalk.bold(`  Backup generations for ${basename(configPath)} (newest first):`));
      for (const g of gens) {
        out(
          `    ${chalk.white(g.id)}  ${chalk.dim(g.createdAt)}  ${chalk.dim(`[${g.files.join(", ")}]`)}`
        );
      }
      out(chalk.dim("\n  Restore the newest: agent-optimizer rollback"));
      out(chalk.dim("  Restore a specific one: agent-optimizer rollback --to <id>"));
    }
    if (legacy.length > 0) {
      out(chalk.dim("\n  Legacy sidecar backup(s) also present (pre-0.13.0):"));
      for (const p of legacy) out(chalk.dim(`    ${p}`));
    }
    return { exitCode: 0 };
  }

  // ── --to <id> ───────────────────────────────────────────────────────────
  if (opts.to) {
    try {
      // restored == the generation's manifest originalPaths. --to restores by id
      // regardless of -c, but warn (don't fail) when it doesn't cover this config,
      // mirroring --list's scoping so the user isn't surprised.
      const restored = restoreBackup(opts.to, store);
      if (json) {
        return { exitCode: 0, json: { schemaVersion: 1, restored, backupId: opts.to } };
      }
      out(chalk.green(`  ✓ Restored backup ${opts.to}`));
      for (const p of restored) out(chalk.dim(`  Restored: ${p}`));
      if (!restored.includes(configPath)) {
        out(
          chalk.yellow(
            `  ⚠ Note: this backup does not include ${configPath} — it restored a different config's file(s).`
          )
        );
      }
      out(chalk.dim(`\n${RESTART}`));
      return { exitCode: 0 };
    } catch (e) {
      if (e instanceof PartialRestoreError) return reportPartialRestore(e, out, json);
      // Unknown / invalid id → plain Error. Nothing was touched.
      if (json) {
        return {
          exitCode: 1,
          json: { schemaVersion: 1, error: "not-found", message: (e as Error).message },
        };
      }
      out(chalk.red(`  ✗ ${(e as Error).message}`));
      out(chalk.dim("  Run `agent-optimizer rollback --list` to see available backups."));
      return { exitCode: 1 };
    }
  }

  // ── no flags: restore the newest store generation for this config ─────────
  const gens = generations();
  if (gens.length > 0) {
    const newest = gens[0];
    // The knob-diff is a human preview only — suppress it in json mode so stdout
    // stays pure JSON (the restore itself still happens below).
    if (!json) printKnobDiff(configPath, join(store, newest.id, basename(configPath)), out);
    try {
      const restored = restoreBackup(newest.id, store);
      if (json) {
        return { exitCode: 0, json: { schemaVersion: 1, restored, backupId: newest.id } };
      }
      out(chalk.green(`  ✓ Config restored from backup ${newest.id}`));
      for (const p of restored) out(chalk.dim(`  Restored: ${p}`));
      out(chalk.dim(`\n${RESTART}`));
      return { exitCode: 0 };
    } catch (e) {
      if (e instanceof PartialRestoreError) return reportPartialRestore(e, out, json);
      // A valid, listed generation that still failed to restore (e.g. a stored
      // blob vanished) — nothing was committed, so not INCONSISTENT (exit 1). Same
      // slug family as apply-plan's rollback-failed, with `inconsistent` false.
      if (json) {
        return {
          exitCode: 1,
          json: {
            schemaVersion: 1,
            error: "rollback-failed",
            backupId: newest.id,
            restored: [],
            failed: "",
            inconsistent: false,
            message: (e as Error).message,
          },
        };
      }
      out(chalk.red(`  ✗ Rollback failed: ${(e as Error).message}`));
      return { exitCode: 1 };
    }
  }

  // ── legacy fallback: pre-0.13.0 sidecars ─────────────────────────────────
  return legacyRollback(configPath, opts.config, out, json);
}

function reportPartialRestore(
  e: PartialRestoreError,
  out: (msg: string) => void,
  json: boolean
): RollbackResult {
  if (json) {
    // Aligned with the apply-plan (Task 8) taxonomy: slug "rollback-failed",
    // `inconsistent` true iff some files were reverted and at least one was not.
    return {
      exitCode: 2,
      json: {
        schemaVersion: 1,
        error: "rollback-failed",
        restored: e.restored,
        failed: e.failed,
        inconsistent: e.restored.length > 0,
        message: e.message,
      },
    };
  }
  out(chalk.red.bold("\n  ✗ CRITICAL: the restore left your files in an INCONSISTENT state."));
  if (e.restored.length > 0) {
    out(chalk.red(`  ${e.restored.length} file(s) were restored:`));
    for (const p of e.restored) out(chalk.red(`    ${p}`));
  }
  out(chalk.red(`  Failed on: ${e.failed}`));
  out(chalk.red("  Manual repair needed."));
  return { exitCode: 2 };
}

/** Best-effort "changes that will be reverted" preview — never fatal. */
function printKnobDiff(currentPath: string, backupPath: string, out: (msg: string) => void): void {
  try {
    const current = JSON.parse(readFileSync(currentPath, "utf-8"));
    const backup = JSON.parse(readFileSync(backupPath, "utf-8"));
    const cCtx = current.agents?.defaults?.contextTokens;
    const bCtx = backup.agents?.defaults?.contextTokens;
    const cHb = current.agents?.defaults?.heartbeat?.every;
    const bHb = backup.agents?.defaults?.heartbeat?.every;
    if (cCtx !== bCtx || cHb !== bHb) {
      out("  Changes that will be reverted:");
      if (cCtx !== bCtx) out(`    contextTokens: ${cCtx} → ${bCtx}`);
      if (cHb !== bHb) out(`    heartbeat: ${cHb} → ${bHb}`);
      out("");
    }
  } catch {
    // Can't diff (missing/unparseable) — proceed silently.
  }
}

function legacyRollback(
  configPath: string,
  configArg: string,
  out: (msg: string) => void,
  json: boolean
): RollbackResult {
  const candidates = sidecarPaths(configPath).filter((p) => existsSync(p));
  if (candidates.length === 0) {
    if (json) {
      // No store generation and no legacy sidecar — nothing to roll back. For an
      // agent this is informational, not a hard failure: exit 0 with a note and
      // the same empty generations/legacySidecars fields as --list.
      return {
        exitCode: 0,
        json: {
          schemaVersion: 1,
          generations: [],
          legacySidecars: [],
          note: "no backups for this config",
        },
      };
    }
    out(chalk.yellow("  No backup found."));
    out(
      chalk.dim(
        `  Expected a store generation, or ${configPath}.pre-optimize.bak / ${configPath}.pre-fix.bak`
      )
    );
    out(
      chalk.dim(
        "  Backups are created automatically by: agent-optimizer optimize  /  agent-optimizer audit --fix"
      )
    );
    return { exitCode: 1 };
  }

  const backupPath = candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!json) printKnobDiff(configPath, backupPath, out);

  copyFileSync(backupPath, configPath);
  const restored: string[] = [configPath];
  if (!json) {
    out(chalk.green("  ✓ Config restored from backup (legacy sidecar)"));
    out(chalk.dim(`  Restored: ${configPath}`));
    out(chalk.dim(`  From:     ${backupPath}`));
  }

  // `audit --fix` (pre-0.13.0) also wrote a models.json sidecar — restore it too
  // so the legacy undo is complete.
  try {
    const restoredCfg = loadConfig(configArg);
    const agentDir = restoredCfg ? findAgentDir(restoredCfg) : null;
    if (agentDir) {
      const modelsPath = resolve(expandPath(agentDir), "models.json");
      const modelsBackup = `${modelsPath}.pre-fix.bak`;
      if (existsSync(modelsBackup)) {
        copyFileSync(modelsBackup, modelsPath);
        restored.push(modelsPath);
        if (!json) {
          out(chalk.green("  ✓ models.json restored from backup"));
          out(chalk.dim(`  Restored: ${modelsPath}`));
        }
      }
    }
  } catch {
    // models.json restore is best-effort — the config restore already succeeded.
  }

  if (json) {
    // Legacy sidecars carry no store generation id, so backupId is null; the note
    // tells the agent this came from the pre-0.13.0 fallback path.
    return {
      exitCode: 0,
      json: {
        schemaVersion: 1,
        restored,
        backupId: null,
        note: "restored from legacy sidecar (pre-0.13.0)",
      },
    };
  }

  out(chalk.dim(`\n${RESTART}`));
  return { exitCode: 0 };
}
