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
    const header =
      err.restored.length > 0
        ? chalk.red.bold(
            "\n  ✗ CRITICAL: the apply failed AND rollback left your files in an INCONSISTENT state. Manual repair needed."
          )
        : chalk.red.bold(
            "\n  ✗ Apply failed and was rolled back, but the rollback itself errored."
          );
    const lines = [
      header,
      ...err.reasons.map((r) => chalk.red(`      • ${r}`)),
      chalk.red(`  backup id: ${err.backupId}`),
      chalk.red(`  Retry the restore with: agent-optimizer rollback --to ${err.backupId}`),
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
