// Docs contract: the root help's `buy` line must list exactly the tier
// choices the registered `buy --tier` option declares, and the purchase
// surface (option, URL handler, pricing, signed-tier set) stays unchanged.
//
// Text assertions over source only — no product code, no CLI, no installs.
// Named *.contract.mjs so Vitest's default *.test/*.spec glob never picks it up.
//
// Run: node --test scripts/docs-contract/buy-help-tiers.contract.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");

const cli = read("src/cli.ts");
const stripe = read("src/licensing/stripe.ts");
const verify = read("src/licensing/verify.ts");

const sortedEq = (a, b, msg) => assert.deepEqual([...a].sort(), [...b].sort(), msg);

// The registered `buy` command, up to its action handler's URL.
function buyCommand() {
  const start = cli.indexOf('.command("buy")');
  assert.notEqual(start, -1, "src/cli.ts registers no buy command");
  const end = cli.indexOf("printBanner();", start);
  assert.notEqual(end, -1);
  return cli.slice(start, end);
}

function declaredTiers() {
  const m = buyCommand().match(
    /\.option\("--tier <tier>", "Pre-select tier: ([a-z |]+)", "([a-z]+)"\)/,
  );
  assert.ok(m, "buy --tier option declaration not found");
  return { tiers: m[1].split("|").map((s) => s.trim()), def: m[2] };
}

// Root help line for buy: `    ${w("buy")} ${d("[--tier ...]")}<pad>${d("...")}`
function rootHelpBuyLine() {
  const m = cli.match(/^ {6}`( {4})\$\{w\("buy"\)\} \$\{d\("\[--tier ([^\]]+)\]"\)\}( +)\$\{d\("([^"]+)"\)\}`,$/m);
  assert.ok(m, "root help buy line not found");
  return { tiers: m[2].split("|"), width: m[1].length + `buy [--tier ${m[2]}]`.length + m[3].length, desc: m[4] };
}

test("source evidence: buy --tier declares solo|fleet|lifetime, default fleet, no extra validation", () => {
  const { tiers, def } = declaredTiers();
  assert.deepEqual(tiers, ["solo", "fleet", "lifetime"]);
  assert.equal(def, "fleet");
  assert.doesNotMatch(buyCommand(), /\.choices\(|new Option\(/, "no parser-level choice validation added");
});

test("source evidence: purchase URL handler is unchanged", () => {
  assert.match(
    buyCommand(),
    /const url = `https:\/\/drakonsystems\.com\/products\/agent-optimizer\/buy\?tier=\$\{opts\.tier\}`;/,
  );
});

test("source evidence: pricing and signed-tier set unchanged and cover every declared tier", () => {
  const prices = [...stripe.matchAll(/id: "([a-z]+)",\s*name: "([^"]+)",\s*price: (\d+),\s*currency: "gbp",\s*tier: "\1"/g)]
    .map((m) => [m[1], m[2], Number(m[3])]);
  assert.deepEqual(prices, [
    ["solo", "Solo License", 2900],
    ["fleet", "Fleet License", 7900],
    ["lifetime", "Lifetime License", 14900],
  ]);
  assert.match(verify, /const TIERS: readonly string\[\] = \["solo", "fleet", "lifetime"\];/);
  sortedEq(declaredTiers().tiers, prices.map((p) => p[0]), "declared tiers match PRICING ids");
});

test("root help buy line enumerates exactly the declared tiers", () => {
  const help = rootHelpBuyLine();
  sortedEq(help.tiers, declaredTiers().tiers);
  assert.equal(help.desc, "Open purchase page");
});

test("root help buy line keeps its description column", () => {
  // Same column the buy line used before (47, indent included) so the UTILITY block stays aligned.
  assert.equal(rootHelpBuyLine().width, 47);
});
