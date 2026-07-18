import { homedir } from "os";
import { join } from "path";

/**
 * Single source of truth for the tool's per-user state directory
 * (~/.agent-optimizer). Saved plans, config backups, and the transactional
 * apply lockfile all live under it, so they resolve it from here rather than
 * re-deriving the path independently.
 */
export function agentOptimizerHome(): string {
  return join(homedir(), ".agent-optimizer");
}
