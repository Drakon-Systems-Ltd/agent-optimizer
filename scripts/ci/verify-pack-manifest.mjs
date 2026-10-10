// CI check: the tarball `npm pack` produced (prepack = root tsc + plugin esbuild
// bundle) ships the CLI and the OpenClaw plugin artifacts, and no source, test,
// workflow or dependency material. Lists the tarball only — nothing is
// published, installed or executed from it.
//
// Run: node scripts/ci/verify-pack-manifest.mjs <path/to/package.tgz>

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(root + p, "utf8"));
const pkg = readJson("package.json");
const plugin = readJson("openclaw-plugin/package.json");

const args = process.argv.slice(2);
assert.equal(args.length, 1, "usage: verify-pack-manifest.mjs <one .tgz>");

const entries = execFileSync("tar", ["-tzf", args[0]], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const files = new Set(
  entries.map((e) => {
    assert.ok(e.startsWith("package/"), `unexpected tarball entry: ${e}`);
    return e.slice("package/".length);
  }),
);

const norm = (p) => p.replace(/^\.\//, "");
const required = [
  "package.json",
  "README.md",
  "LICENSE.md",
  "CHANGELOG.md",
  ...Object.values(pkg.bin).map(norm),
  "openclaw-plugin/package.json",
  "openclaw-plugin/openclaw.plugin.json",
  `openclaw-plugin/${norm(plugin.main)}`,
  ...plugin.openclaw.extensions.map((p) => `openclaw-plugin/${norm(p)}`),
];
const missing = [...new Set(required)].filter((f) => !files.has(f));
assert.deepEqual(missing, [], "tarball is missing shipped artifacts");

const forbidden = [...files].filter(
  (f) =>
    /^(src|tests|scripts|skills|docs|\.github|node_modules)\//.test(f) ||
    /^openclaw-plugin\/(src|node_modules)\//.test(f) ||
    /(^|\/)(package-lock\.json|\.env[^/]*|[^/]+\.tgz)$/.test(f) ||
    (/\.ts$/.test(f) && !/\.d\.ts$/.test(f)),
);
assert.deepEqual(forbidden, [], "tarball ships non-artifact files");

console.log(`pack manifest ok: ${files.size} files, ${required.length} required artifacts present`);
