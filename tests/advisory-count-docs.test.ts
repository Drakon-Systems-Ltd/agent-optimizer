import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Documentation contract: every "N known issues" claim in the README must match
// the number of objects in the ADVISORIES array. Scans the source text for
// top-level object literals in the array (skipping strings and comments), so it
// does not depend on the array being exported or on GHSA ids (not every entry
// has one).
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function countAdvisories(): number {
  const src = readFileSync(join(root, "src/auditors/openclaw/security-advisories.ts"), "utf8");
  const decl = src.indexOf("const ADVISORIES: SecurityAdvisory[] = [");
  expect(decl).toBeGreaterThanOrEqual(0);
  let i = src.indexOf("[", src.indexOf("=", decl)) + 1;
  let depth = 0;
  let count = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; src[i] !== c; i++) if (src[i] === "\\") i++;
    } else if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
    } else if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i) + 1;
    } else if (c === "{" || c === "[") {
      if (depth === 0 && c === "{") count++;
      depth++;
    } else if (c === "}" || c === "]") {
      if (depth === 0) break; // closing bracket of ADVISORIES
      depth--;
    }
  }
  return count;
}

describe("advisory count in README", () => {
  it("matches the ADVISORIES array length", () => {
    const count = countAdvisories();
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const claims = [...readme.matchAll(/(\d+) known issues/g)].map((m) => Number(m[1]));
    expect(claims.length).toBeGreaterThan(0);
    expect(claims).toEqual(claims.map(() => count));
  });
});
