// TEST-ONLY module hooks; see license-key-loader.mjs.
let testKey;

export function initialize(data) {
  testKey = data?.key;
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!testKey || !url.split("?")[0].endsWith("/src/licensing/keys.ts")) return result;
  const src = String(result.source);
  const swapped = src.replace(/(PUBLIC_KEY_B64\s*=\s*)"[A-Za-z0-9+/=]+"/, `$1"${testKey}"`);
  if (swapped === src) throw new Error("license-key-hooks: PUBLIC_KEY_B64 literal not found");
  return { ...result, source: swapped };
}
