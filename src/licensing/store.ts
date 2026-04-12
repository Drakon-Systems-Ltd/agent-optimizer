import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { License } from "./keys.js";

const LICENSE_DIR = join(homedir(), ".agent-optimizer");
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
 */
export function loadLicense(): License | null {
  if (!existsSync(LICENSE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(LICENSE_FILE, "utf-8")) as License;
  } catch {
    return null;
  }
}

/**
 * Remove the saved license.
 */
export function removeLicense(): boolean {
  if (!existsSync(LICENSE_FILE)) return false;
  const { unlinkSync } = require("fs");
  unlinkSync(LICENSE_FILE);
  return true;
}

/**
 * Get the license file path (for display).
 */
export function getLicensePath(): string {
  return LICENSE_FILE;
}
