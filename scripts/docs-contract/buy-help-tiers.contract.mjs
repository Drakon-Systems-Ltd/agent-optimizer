// Docs contract: the root help's `buy` line must list exactly the tier
// choices the registered `buy --tier` option declares; the action validates
// the tier (closed set) before printing or launching anything; the purchase URL
// is fixed, allowlisted and opened via execFile without a shell (#12); and the
// commercial surface (pricing, signed-tier set) stays unchanged.
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
const buy = read("src/utils/buy.ts");
const stripe = read("src/licensing/stripe.ts");
const verify = read("src/licensing/verify.ts");

const sortedEq = (a, b, msg) => assert.deepEqual([...a].sort(), [...b].sort(), msg);

// The registered `buy` command, through the end of its action handler.
function buyCommand() {
  const start = cli.indexOf('.command("buy")');
  assert.notEqual(start, -1, "src/cli.ts registers no buy command");
  const end = cli.indexOf("\n  });\n", start);
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

test("source evidence: buy --tier declares solo|fleet|lifetime, default fleet", () => {
  const { tiers, def } = declaredTiers();
  assert.deepEqual(tiers, ["solo", "fleet", "lifetime"]);
  assert.equal(def, "fleet");
});

test("source evidence: the buy action validates the tier before it prints or opens anything", () => {
  const action = buyCommand();
  const parse = action.indexOf("parseBuyTier(opts.tier)");
  assert.notEqual(parse, -1, "buy action does not call parseBuyTier(opts.tier)");
  const banner = action.indexOf("printBanner();");
  const open = action.indexOf("openPurchasePage(tier");
  assert.ok(banner > parse, "printBanner() runs only after tier validation");
  assert.ok(open > parse, "openPurchasePage() receives the validated tier");
  assert.match(action.slice(parse, banner), /if \(tier === null\) \{[\s\S]*?process\.exitCode = 1;[\s\S]*?return;/);
  // The tier never reaches a URL template or a shell from the CLI layer.
  assert.doesNotMatch(action, /\$\{opts\.tier\}|\bexec\(|execSync\(/);
});

test("source evidence: purchase URL is fixed, allowlisted and launched without a shell", () => {
  assert.match(buy, /const PURCHASE_URL = "https:\/\/drakonsystems\.com\/products\/agent-optimizer\/buy";/);
  assert.match(
    buy,
    /const ALLOWED_URL = \/\^https:\\\/\\\/drakonsystems\\\.com\\\/products\\\/agent-optimizer\\\/buy\\\?tier=\(solo\|fleet\|lifetime\)\$\/;/,
  );
  assert.match(buy, /input === "solo" \|\| input === "fleet" \|\| input === "lifetime"/);
  assert.match(buy, /execFile\(file, args, \{ shell: false \}, callback\)/);
  // child_process exec/execSync go through a shell; RegExp#exec (ALLOWED_URL.exec) is fine.
  assert.doesNotMatch(buy, /(?<![.\w])exec\(|execSync\(|shell: true|import \{[^}]*\bexec\b[^}]*\} from "child_process"/);
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
