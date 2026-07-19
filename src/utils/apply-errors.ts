import chalk from "chalk";
import {
  ApplyLockedError,
  ApplyPreconditionError,
  ApplyRolledBackError,
  RollbackFailedError,
} from "./transactional.js";

/**
 * Human-readable rendering of a transactionalApply failure, plus the exit code
 * the CLI should adopt. One source of truth shared by every writer that routes
 * through transactionalApply (optimize apply, audit --fix, and — next — optimize
 * --apply-plan), so the four typed errors always read and exit identically.
 *
 * Exit codes: 1 for a clean rollback / locked / precondition (config untouched),
 * 2 for RollbackFailedError (the LOUD double-failure — the disk may be dirty).
 */
export interface FormattedApplyError {
  text: string;
  exitCode: number;
}

export function formatApplyError(err: unknown): FormattedApplyError {
  if (err instanceof ApplyRolledBackError) {
    const lines = [
      chalk.yellow(
        "\n  ⚠ The change would have broken your config — nothing was applied (automatically rolled back)."
      ),
      ...err.reasons.map((r) => chalk.yellow(`      • ${r}`)),
      chalk.yellow("  Your config is unchanged."),
      chalk.dim(`  backup id: ${err.backupId}`),
    ];
    return { text: lines.join("\n"), exitCode: 1 };
  }

  if (err instanceof RollbackFailedError) {
    // restored>0: some originals were reverted, at least one was NOT → the disk
    // is a mix (INCONSISTENT). restored===0: NOTHING was reverted, so the broken
    // mutation is still live on disk — never say "was rolled back" here.
    const header =
      err.restored.length > 0
        ? chalk.red.bold(
            "\n  ✗ CRITICAL: the apply failed AND rollback left your files in an INCONSISTENT state. Manual repair needed."
          )
        : chalk.red.bold(
            "\n  ✗ Apply failed and the automatic rollback ALSO failed — nothing was reverted, so your config is still in the changed (possibly broken) state. Restore it with the command below."
          );
    const lines = [
      header,
      ...err.reasons.map((r) => chalk.red(`      • ${r}`)),
      chalk.red(`  backup id: ${err.backupId}`),
      chalk.red(`  Restore the original config with: agent-optimizer rollback --to ${err.backupId}`),
    ];
    return { text: lines.join("\n"), exitCode: 2 };
  }

  if (err instanceof ApplyLockedError) {
    return {
      text: chalk.yellow("\n  ⚠ Another apply is already in progress. Try again in a moment."),
      exitCode: 1,
    };
  }

  if (err instanceof ApplyPreconditionError) {
    return {
      text:
        chalk.yellow(
          "\n  ⚠ Cannot apply: your config already has problems (or its files couldn't be backed up). Fix those first."
        ) +
        "\n  " +
        chalk.dim((err as Error).message),
      exitCode: 1,
    };
  }

  // Anything else is unexpected (a real bug, not a safety path). Surface it
  // rather than swallowing it silently, but keep the CLI from crashing.
  return {
    text: chalk.red(`\n  ✗ Unexpected apply error: ${(err as Error).message ?? String(err)}`),
    exitCode: 1,
  };
}

/**
 * Shared success footer for every writer that applies through transactionalApply
 * (optimize apply, audit --fix, and — next — optimize --apply-plan): the backup
 * id, the restart hint, and an always-correct restore pointer. It points at
 * `rollback --to <id>` rather than a bare `rollback` on purpose — bare rollback
 * resolves the DEFAULT config path and would miss a non-default `-c`, whereas the
 * id is unambiguous. One source so the three (soon four) success sites can't drift.
 */
export function formatApplySuccess(backupId: string): string {
  return [
    chalk.dim(`\n  Backup: ${backupId}`),
    chalk.dim("  Restart the gateway to apply: systemctl --user restart openclaw-gateway"),
    chalk.dim(`  Something wrong? Restore with: agent-optimizer rollback --to ${backupId}`),
  ].join("\n");
}
