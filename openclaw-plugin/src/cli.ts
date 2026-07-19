// Thin, safe wrapper around the installed `agent-optimizer` CLI.
//
// Every tool in this plugin shells out to the CLI with an argv ARRAY (never a
// shell string), parses the machine JSON contract the CLI already emits, and
// returns a structured result. A non-zero exit is NOT treated as a failure:
// `optimize --apply-plan` uses exit codes 2-8 to classify outcomes (e.g. exit 5
// = applied-then-auto-rolled-back, a safe, expected result the agent must see),
// and it emits a `{ error: <slug>, ... }` JSON envelope alongside. We surface
// both the parsed JSON and the exit code so the agent gets the whole picture.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** CLI to invoke when the plugin config does not override `cliPath`. */
export const DEFAULT_CLI = "agent-optimizer";

/** Generous ceiling — `audit --deep` can probe a live gateway. */
const TIMEOUT_MS = 120_000;
/** Audit reports and scans can be large; keep well clear of the 1 MB default. */
const MAX_BUFFER = 32 * 1024 * 1024;

// Strip SGR colour codes so text output is clean for the model. The CLI writes
// chalk-coloured human text to some verbs (rollback, scan) that have no JSON mode.
const ANSI_SGR = /\[[0-9;]*m/g;
const stripAnsi = (value: string): string => value.replace(ANSI_SGR, "");

/** The CLI could not be run or produced no usable machine output. */
export interface CliFailed {
  error: "cli-failed";
  message: string;
  /** Process exit code when the CLI ran but its output was unusable; null on spawn failure. */
  exitCode: number | null;
  stderr: string;
}

/** Parsed-JSON result for the machine verbs (audit / plan / apply). */
export interface CliJsonResult {
  format: "json";
  /** True only on a clean (exit 0) run. Apply exit 5/8 etc. are ok:false but still carry `data`. */
  ok: boolean;
  exitCode: number;
  /** The CLI's parsed JSON — a result object, or a `{ error: <slug>, ... }` envelope. */
  data: unknown;
}

/** Text result for the human verbs that have no `--json` mode (scan / rollback). */
export interface CliTextResult {
  format: "text";
  ok: boolean;
  exitCode: number;
  output: string;
  stderr: string;
}

export interface RunOptions {
  /** Override the CLI binary/command (from plugin config `cliPath`). */
  cliPath?: string;
  /** Propagated from the tool handler so cancellation kills the child process. */
  signal?: AbortSignal;
}

interface RawRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function resolveBin(cliPath?: string): string {
  const trimmed = cliPath?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_CLI;
}

/**
 * Run the CLI once. Returns captured output + exit code even when the process
 * exits non-zero (execFile rejects on non-zero, but still hands back
 * stdout/stderr and a numeric `code`). Only a genuine spawn failure — the binary
 * is missing, a timeout, or an abort — becomes a `CliFailed`.
 */
async function invoke(args: string[], opts: RunOptions): Promise<RawRun | CliFailed> {
  const bin = resolveBin(opts.cliPath);
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      signal: opts.signal,
      // Never route through a shell — args are passed as an argv array.
      shell: false,
      windowsHide: true,
    });
    return { exitCode: 0, stdout: String(stdout), stderr: String(stderr) };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      killed?: boolean;
    };
    // Non-zero exit: `code` is the numeric exit status and output is attached.
    if (typeof e.code === "number") {
      return {
        exitCode: e.code,
        stdout: String(e.stdout ?? ""),
        stderr: String(e.stderr ?? ""),
      };
    }
    // Spawn failure (ENOENT = not installed), timeout, or abort.
    const message =
      e.code === "ENOENT"
        ? `agent-optimizer CLI not found (tried "${bin}"). Install it (npm i -g @drakon-systems/agent-optimizer) or set the plugin's cliPath config.`
        : e.killed
          ? `agent-optimizer ${args[0] ?? ""} was aborted or timed out.`
          : (e.message ?? String(err));
    return {
      error: "cli-failed",
      message,
      exitCode: typeof e.code === "number" ? e.code : null,
      stderr: stripAnsi(String(e.stderr ?? "")).trim().slice(0, 4000),
    };
  }
}

/** Run a machine verb and parse stdout as JSON (exit code is preserved, never thrown). */
export async function runJson(args: string[], opts: RunOptions): Promise<CliJsonResult | CliFailed> {
  const raw = await invoke(args, opts);
  if ("error" in raw) {
    return raw;
  }
  const trimmed = raw.stdout.trim();
  try {
    const data: unknown = JSON.parse(trimmed);
    return { format: "json", ok: raw.exitCode === 0, exitCode: raw.exitCode, data };
  } catch {
    return {
      error: "cli-failed",
      message: `agent-optimizer ${args[0] ?? ""} did not emit valid JSON on stdout (exit ${raw.exitCode}).`,
      exitCode: raw.exitCode,
      stderr: stripAnsi(raw.stderr).trim().slice(0, 4000),
    };
  }
}

/** Run a human verb (no `--json` mode) and return cleaned text + exit code. */
export async function runText(args: string[], opts: RunOptions): Promise<CliTextResult | CliFailed> {
  const raw = await invoke(args, opts);
  if ("error" in raw) {
    return raw;
  }
  return {
    format: "text",
    ok: raw.exitCode === 0,
    exitCode: raw.exitCode,
    output: stripAnsi(raw.stdout).trim(),
    stderr: stripAnsi(raw.stderr).trim(),
  };
}
