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
  /** Test-only injection; defaults to defaultBackupsDir(). */
  backupsDir?: string;
  /** Sink for human output; defaults to console.log. */
  out?: (msg: string) => void;
}

const RESTART = "  Restart the gateway to apply: systemctl --user restart openclaw-gateway";

/**
 * Restore an OpenClaw config (and any co-snapshotted files) from the backup
 * store, with a fallback to the pre-0.13.0 `.pre-optimize.bak` / `.pre-fix.bak`
 * sidecars so backups written by older versions still restore.
 *
 * Returns the process exit code: 0 on success / informational listing, 1 on a
 * plain error (nothing changed), 2 on a partial restore (disk INCONSISTENT).
 */
export function runRollback(opts: RollbackOptions): number {
  const out = opts.out ?? console.log;
  const store = opts.backupsDir ?? defaultBackupsDir();
  const configPath = resolve(expandPath(opts.config));

  // Store generations whose manifest restores THIS config, newest-first.
  const generations = () =>
    listBackups(store).filter((b) => b.originalPaths.includes(configPath));
  const legacySidecars = () =>
    [`${configPath}.pre-fix.bak`, `${configPath}.pre-optimize.bak`].filter((p) => existsSync(p));

  // ── --list ──────────────────────────────────────────────────────────────
  if (opts.list) {
    const gens = generations();
    const legacy = legacySidecars();
    if (gens.length === 0 && legacy.length === 0) {
      out(chalk.yellow("  No backups found for this config."));
      out(chalk.dim(`  Config: ${configPath}`));
      out(chalk.dim("  Backups are created by: agent-optimizer optimize  /  agent-optimizer audit --fix"));
      return 0;
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
    return 0;
  }

  // ── --to <id> ───────────────────────────────────────────────────────────
  if (opts.to) {
    try {
      const restored = restoreBackup(opts.to, store);
      out(chalk.green(`  ✓ Restored backup ${opts.to}`));
      for (const p of restored) out(chalk.dim(`  Restored: ${p}`));
      out(chalk.dim(`\n${RESTART}`));
      return 0;
    } catch (e) {
      if (e instanceof PartialRestoreError) return reportPartialRestore(e, out);
      // Unknown / invalid id → plain Error. Nothing was touched.
      out(chalk.red(`  ✗ ${(e as Error).message}`));
      out(chalk.dim("  Run `agent-optimizer rollback --list` to see available backups."));
      return 1;
    }
  }

  // ── no flags: restore the newest store generation for this config ─────────
  const gens = generations();
  if (gens.length > 0) {
    const newest = gens[0];
    printKnobDiff(configPath, join(store, newest.id, basename(configPath)), out);
    try {
      const restored = restoreBackup(newest.id, store);
      out(chalk.green(`  ✓ Config restored from backup ${newest.id}`));
      for (const p of restored) out(chalk.dim(`  Restored: ${p}`));
      out(chalk.dim(`\n${RESTART}`));
      return 0;
    } catch (e) {
      if (e instanceof PartialRestoreError) return reportPartialRestore(e, out);
      out(chalk.red(`  ✗ Rollback failed: ${(e as Error).message}`));
      return 1;
    }
  }

  // ── legacy fallback: pre-0.13.0 sidecars ─────────────────────────────────
  return legacyRollback(configPath, opts.config, out);
}

function reportPartialRestore(e: PartialRestoreError, out: (msg: string) => void): number {
  out(chalk.red.bold("\n  ✗ CRITICAL: the restore left your files in an INCONSISTENT state."));
  if (e.restored.length > 0) {
    out(chalk.red(`  ${e.restored.length} file(s) were restored:`));
    for (const p of e.restored) out(chalk.red(`    ${p}`));
  }
  out(chalk.red(`  Failed on: ${e.failed}`));
  out(chalk.red("  Manual repair needed."));
  return 2;
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
  out: (msg: string) => void
): number {
  const candidates = [`${configPath}.pre-fix.bak`, `${configPath}.pre-optimize.bak`].filter((p) =>
    existsSync(p)
  );
  if (candidates.length === 0) {
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
    return 1;
  }

  const backupPath = candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  printKnobDiff(configPath, backupPath, out);

  copyFileSync(backupPath, configPath);
  out(chalk.green("  ✓ Config restored from backup (legacy sidecar)"));
  out(chalk.dim(`  Restored: ${configPath}`));
  out(chalk.dim(`  From:     ${backupPath}`));

  // `audit --fix` (pre-0.13.0) also wrote a models.json sidecar — restore it too
  // so the legacy undo is complete.
  try {
    const restored = loadConfig(configArg);
    const agentDir = restored ? findAgentDir(restored) : null;
    if (agentDir) {
      const modelsPath = resolve(expandPath(agentDir), "models.json");
      const modelsBackup = `${modelsPath}.pre-fix.bak`;
      if (existsSync(modelsBackup)) {
        copyFileSync(modelsBackup, modelsPath);
        out(chalk.green("  ✓ models.json restored from backup"));
        out(chalk.dim(`  Restored: ${modelsPath}`));
      }
    }
  } catch {
    // models.json restore is best-effort — the config restore already succeeded.
  }

  out(chalk.dim(`\n${RESTART}`));
  return 0;
}
