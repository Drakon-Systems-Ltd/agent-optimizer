import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Documentation contract: every "N known issues" claim in the README must equal
// the number of entries in the ADVISORIES array literal. The array is counted
// from the TypeScript AST (the compiler is already a devDependency), so it does
// not depend on the array being exported, on formatting, or on GHSA ids (not
// every entry has one).
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Bump together with the README when advisories are added or removed.
const EXPECTED_ADVISORY_COUNT = 72;

function countAdvisories(): number {
  const file = "src/auditors/openclaw/security-advisories.ts";
  const source = ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest);
  for (const stmt of source.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== "ADVISORIES") continue;
      const init = decl.initializer;
      if (!init || !ts.isArrayLiteralExpression(init)) {
        throw new Error(`${file}: ADVISORIES is not initialised with an array literal`);
      }
      const nonObjects = init.elements.filter((e) => !ts.isObjectLiteralExpression(e));
      if (nonObjects.length > 0) {
        throw new Error(`${file}: ADVISORIES has ${nonObjects.length} element(s) that are not object literals`);
      }
      return init.elements.length;
    }
  }
  throw new Error(`${file}: no top-level ADVISORIES declaration found`);
}

describe("advisory count in README", () => {
  it("matches the ADVISORIES array length", () => {
    const count = countAdvisories();
    expect(count, "ADVISORIES entries vs EXPECTED_ADVISORY_COUNT").toBe(EXPECTED_ADVISORY_COUNT);

    const readme = readFileSync(join(root, "README.md"), "utf8");
    const claims = [...readme.matchAll(/(\d+) known issues/g)].map((m) => Number(m[1]));
    // The feature table row and the Security Advisories section.
    expect(claims, "README \"N known issues\" claims").toHaveLength(2);
    expect(claims, `README claims vs ${count} ADVISORIES entries`).toEqual([count, count]);
  });
});
