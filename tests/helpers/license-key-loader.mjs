// TEST-ONLY entry for spawned CLI tests:
//   node --import tsx --import ./tests/helpers/license-key-loader.mjs src/cli.ts
// Registers license-key-hooks.mjs, which swaps the embedded public key in
// src/licensing/keys.ts for the ephemeral test key in AO_TEST_LICENSE_PUBKEY_B64
// so a subprocess can reach the licensed path with a fixture signed inside the
// test. Production code has no such override; this file is never shipped.
import { register } from "node:module";

register(new URL("./license-key-hooks.mjs", import.meta.url), {
  data: { key: process.env.AO_TEST_LICENSE_PUBKEY_B64 },
});
