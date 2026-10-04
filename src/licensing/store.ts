import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import type { License } from "./keys.js";
import { agentOptimizerHome } from "../utils/paths.js";

const LICENSE_DIR = agentOptimizerHome();
const LICENSE_FILE = join(LICENSE_DIR, "license.json");

/**
 * Save a license to disk.
 */
export function saveLicense(license: License): void {
  if (!existsSync(LICENSE_DIR)) {
    mkdirSync(LICENSE_DIR, { recursive: true });
  }
  writeFileSync(LICENSE_FILE, JSON.stringify(license, null, 2), { mode: 0o600 });
}

/**
 * Load the saved license from disk.
 *
 * Only checks the file is structurally a license (so callers can read its
 * fields without crashing); authenticity is `validateLicense`'s job, and
 * nothing loaded here is trusted until that passes.
 */
export function loadLicense(): License | null {
  if (!existsSync(LICENSE_FILE)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(LICENSE_FILE, "utf-8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const { key, data, signature } = parsed as Record<string, unknown>;
    if (typeof key !== "string" || typeof signature !== "string") return null;
    if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
    return parsed as License;
  } catch {
    return null;
  }
}

/**
 * Remove the saved license.
 */
export function removeLicense(): boolean {
  if (!existsSync(LICENSE_FILE)) return false;
  unlinkSync(LICENSE_FILE);
  return true;
}

/**
 * Get the license file path (for display).
 */
export function getLicensePath(): string {
  return LICENSE_FILE;
}
