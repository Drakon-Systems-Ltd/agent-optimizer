import type { OptimizeOptions } from "../types.js";
import { runOpenClawOptimize, OPTIMIZATION_TAGS } from "./openclaw/index.js";

export interface Optimization {
  tag: string;
  path: string;
  current: unknown;
  recommended: unknown;
  reason: string;
  /** Suggestion-only — printed in dry-run, filtered out of the apply loop. */
  info?: true;
}

// Re-export shared types and constants from OpenClaw for back-compat with
// callers that imported from "src/optimizers/index.js" pre-refactor.
export { OPTIMIZATION_TAGS };
export { getOptimizations } from "./openclaw/index.js";
export type { OptimizationTag } from "./openclaw/index.js";

/**
 * Top-level optimize dispatcher. Routes to the appropriate per-system
 * optimizer. For v0.11.0, only OpenClaw has an apply-capable optimizer;
 * Claude Code is added as info-only in a follow-up commit.
 */
export async function runOptimize(opts: OptimizeOptions): Promise<void> {
  return runOpenClawOptimize(opts);
}
