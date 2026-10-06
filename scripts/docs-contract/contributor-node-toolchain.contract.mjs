// Docs contract: the README "Development" section must state the Node.js
// version the committed dev toolchain actually needs, separately from the
// published runtime support (`engines.node`).
//
// Text/JSON assertions only — no product code, no CLI, no installs.
// Named *.contract.mjs so Vitest's default *.test/*.spec glob never picks it up.
//
// Run: node --test scripts/docs-contract/contributor-node-toolchain.contract.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");

const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const ci = read(".github/workflows/ci.yml");
const readme = read("README.md");

function section(md, heading) {
  const start = md.indexOf(`\n## ${heading}\n`);
  assert.notEqual(start, -1, `README has no "## ${heading}" section`);
  const rest = md.slice(start + 1);
  const next = rest.indexOf("\n## ", 1);
  return next === -1 ? rest : rest.slice(0, next);
}

const dev = section(readme, "Development");

test("source evidence: published runtime support stays engines >=20", () => {
  assert.equal(pkg.engines.node, ">=20");
  assert.equal(lock.packages[""].engines.node, ">=20");
  assert.match(section(readme, "Install"), /Requires Node\.js 20\+/);
});

test("source evidence: locked dev toolchain engine ranges", () => {
  const engines = (name) => lock.packages[`node_modules/${name}`]?.engines?.node;
  assert.equal(engines("vite"), "^20.19.0 || >=22.12.0");
  assert.equal(engines("rolldown"), "^20.19.0 || >=22.12.0");
  assert.equal(engines("vitest"), "^20.0.0 || ^22.0.0 || >=24.0.0");
  assert.equal(engines("tsx"), ">=18.0.0");
  assert.equal(engines("typescript"), ">=14.17");
});

test("source evidence: CI runs on Node 22 with build + vitest run", () => {
  assert.match(ci, /node-version:\s*22\b/);
  assert.match(ci, /run: npm run build\b/);
  assert.match(ci, /run: npx vitest run\b/);
});

test("Development section states the toolchain Node range and the Node 22 baseline", () => {
  assert.match(dev, /Node\.js 22/, "recommends a Node 22 baseline");
  assert.match(dev, /22\.12/, "names the 22.12 floor from Vite/Rolldown");
  assert.match(dev, /20\.19/, "names the 20.19 floor for Node 20 lines");
  assert.match(dev, /Node(\.js)? 23/, "notes Node 23 is outside Vitest's range");
  assert.match(dev, /engines|runtime/i, "distinguishes from published runtime support");
});

test("Development section commands match package scripts and CI", () => {
  assert.equal(pkg.scripts.test, "vitest");
  assert.equal(pkg.scripts.build, "tsc");
  assert.match(dev, /npx vitest run/, "gives the unattended test command");
  assert.match(dev, /npm test[^\n]*watch/i, "labels npm test as watch mode");
  assert.match(dev, /npm run build[^\n]*tsc/i);
  assert.doesNotMatch(dev, /\d+ passing/, "no unverifiable test-count claim");
});
