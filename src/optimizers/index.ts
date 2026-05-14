import type { OptimizeOptions } from "../types.js";
import { detectSystems } from "../detect/index.js";
import { runOpenClawOptimize, OPTIMIZATION_TAGS } from "./openclaw/index.js";
import { runClaudeCodeOptimize, CC_OPTIMIZATION_TAGS } from "./claude-code/index.js";

export interface Optimization {
  tag: string;
  path: string;
  current: unknown;
  recommended: unknown;
  reason: string;
  /** Suggestion-only — printed in dry-run, filtered out of the apply loop. */
  info?: true;
}

// Re-export shared types and constants from OpenClaw + Claude Code for
// back-compat with callers that imported from "src/optimizers/index.js".
export { OPTIMIZATION_TAGS, CC_OPTIMIZATION_TAGS };
export { getOptimizations } from "./openclaw/index.js";
export type { OptimizationTag } from "./openclaw/index.js";
export { getClaudeCodeOptimizations } from "./claude-code/index.js";
export type { CcOptimizationTag, ClaudeCodeSettings } from "./claude-code/index.js";

/**
 * Top-level optimize dispatcher. Routes to the appropriate per-system
 * optimizer:
 * - explicit opts.system wins
 * - otherwise default to OpenClaw for back-compat (the only apply-capable
 *   target), unless Claude Code is the only system detected
 */
export async function runOptimize(opts: OptimizeOptions): Promise<void> {
  const systems = detectSystems();
  const hasClaudeCode = systems.some((s) => s.kind === "claude-code");
  const hasOpenClaw = systems.some((s) => s.kind === "openclaw");

  const target: "claude-code" | "openclaw" =
    opts.system ?? (hasClaudeCode && !hasOpenClaw ? "claude-code" : "openclaw");

  if (target === "claude-code") {
    return runClaudeCodeOptimize(opts);
  }
  return runOpenClawOptimize(opts);
}
