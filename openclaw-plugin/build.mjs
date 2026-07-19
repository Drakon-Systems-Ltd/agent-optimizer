// Bundle the plugin to a single self-contained dist/index.js.
//
// - `openclaw/*` is EXTERNAL: the host process provides the plugin SDK at load
//   time (exactly like the reference ekho-adapter plugin), so we must not bundle
//   it — the plugin must use the host's SDK instance, not a copy.
// - `typebox` IS bundled, so the artifact is self-contained and loads from a bare
//   symlinked extensions/ directory with no node_modules present.
// - node built-ins are external automatically under platform: "node".

import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["openclaw", "openclaw/*"],
  banner: {
    js: "// @drakon-systems/agent-optimizer-openclaw-plugin — bundled. Edit src/, run `npm run build`.",
  },
  logLevel: "info",
});

console.log("built dist/index.js");
