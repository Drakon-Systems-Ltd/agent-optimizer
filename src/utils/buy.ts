import { execFile } from "child_process";
import type { PricingTier } from "../licensing/stripe.js";

export type BuyTier = PricingTier["tier"];

export type BrowserLauncher = (
  file: string,
  args: string[],
  callback: (error: Error | null) => void
) => void;

export interface OpenPurchaseOptions {
  platform?: string;
  launcher?: BrowserLauncher;
  onError?: (error: Error) => void;
}

const PURCHASE_URL = "https://drakonsystems.com/products/agent-optimizer/buy";
const ALLOWED_URL = /^https:\/\/drakonsystems\.com\/products\/agent-optimizer\/buy\?tier=(solo|fleet|lifetime)$/;

// Tier names are exact and lowercase; whitespace and case variants are invalid.
export function parseBuyTier(input: string): BuyTier | null {
  return input === "solo" || input === "fleet" || input === "lifetime" ? input : null;
}

export function buildBuyUrl(tier: BuyTier): string {
  if (parseBuyTier(tier) === null) throw new Error("Invalid purchase tier");
  const url = new URL(PURCHASE_URL);
  url.searchParams.set("tier", tier);
  return url.toString();
}

export function browserOpenCommand(platform: string, url: string): { file: string; args: string[] } {
  const match = ALLOWED_URL.exec(url);
  if (!match || match[0] !== url) throw new Error("Invalid purchase URL");

  if (platform === "darwin") return { file: "open", args: [url] };
  // rundll32 takes the URL as one argv element, avoiding cmd.exe's metacharacter parsing.
  if (platform === "win32") return { file: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  return { file: "xdg-open", args: [url] };
}

export function openPurchasePage(
  input: string = "fleet",
  { platform = process.platform, launcher = (file, args, callback) => {
    execFile(file, args, { shell: false }, callback);
  }, onError }: OpenPurchaseOptions = {}
): string | null {
  const tier = parseBuyTier(input);
  if (tier === null) return null;

  const url = buildBuyUrl(tier);
  const { file, args } = browserOpenCommand(platform, url);
  launcher(file, args, (error) => {
    if (error) onError?.(error);
  });
  return url;
}
