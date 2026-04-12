/**
 * Stripe Webhook Handler for Agent Optimizer
 *
 * Handles checkout.session.completed events and generates license keys.
 * Deploy as a serverless function or standalone Express server.
 *
 * Environment variables:
 *   STRIPE_SECRET_KEY     - Stripe secret key
 *   STRIPE_WEBHOOK_SECRET - Webhook signing secret
 *   LICENSE_STORE_PATH    - Path to license store JSON file (default: ./licenses.json)
 */

import Stripe from "stripe";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { createLicense } from "../src/licensing/keys.js";
import type { License } from "../src/licensing/keys.js";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
const LICENSE_STORE_PATH = process.env.LICENSE_STORE_PATH ?? "./licenses.json";
const PORT = parseInt(process.env.PORT ?? "3456", 10);

if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
  console.error("Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

// --- License store (JSON file, swap for DB in production) ---

interface LicenseStore {
  licenses: Record<string, License>; // keyed by license key
  payments: Record<string, string>; // payment_id -> license_key (idempotency)
}

function loadStore(): LicenseStore {
  if (!existsSync(LICENSE_STORE_PATH)) {
    return { licenses: {}, payments: {} };
  }
  return JSON.parse(readFileSync(LICENSE_STORE_PATH, "utf-8"));
}

function saveStore(store: LicenseStore): void {
  writeFileSync(LICENSE_STORE_PATH, JSON.stringify(store, null, 2), {
    mode: 0o600,
  });
}

// --- Request helpers ---

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// --- Webhook handler ---

async function handleWebhook(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = await readBody(req);
  const signature = req.headers["stripe-signature"] as string;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    console.error("Webhook signature verification failed:", (e as Error).message);
    json(res, 400, { error: "Invalid signature" });
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const tier = (session.metadata?.tier ?? "solo") as
      | "solo"
      | "fleet"
      | "lifetime";
    const email = session.customer_email ?? session.metadata?.email ?? "unknown";
    const paymentId = session.payment_intent as string;

    // Idempotency — don't create duplicate licenses for the same payment
    const store = loadStore();
    if (store.payments[paymentId]) {
      const existingKey = store.payments[paymentId];
      console.log(
        `Payment ${paymentId} already processed — license ${existingKey}`
      );
      json(res, 200, { received: true, license_key: existingKey });
      return;
    }

    // Generate license
    const license = createLicense(email, tier, paymentId);

    // Store
    store.licenses[license.key] = license;
    store.payments[paymentId] = license.key;
    saveStore(store);

    console.log(
      `License created: ${license.key} (${tier}) for ${email} — payment ${paymentId}`
    );

    // TODO: Send license key via email (Resend/SendGrid)

    json(res, 200, { received: true, license_key: license.key });
    return;
  }

  json(res, 200, { received: true });
}

// --- Activation endpoint ---

async function handleActivation(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = await readBody(req);
  const { key, email } = JSON.parse(body.toString()) as {
    key: string;
    email?: string;
  };

  const store = loadStore();
  const license = store.licenses[key];

  if (!license) {
    json(res, 404, { error: "License key not found" });
    return;
  }

  // Optional email verification
  if (email && license.data.email !== email) {
    json(res, 403, { error: "Email does not match the license" });
    return;
  }

  json(res, 200, license);
}

// --- Checkout session creator ---

async function handleCreateCheckout(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = await readBody(req);
  const { tier, email } = JSON.parse(body.toString()) as {
    tier: string;
    email: string;
  };

  const { PRICING } = await import("../src/licensing/stripe.js");
  const pricing = PRICING.find((p) => p.tier === tier);
  if (!pricing) {
    json(res, 400, { error: `Unknown tier: ${tier}` });
    return;
  }

  const { createCheckoutSession } = await import("../src/licensing/stripe.js");
  const session = await createCheckoutSession(
    stripe,
    pricing,
    email,
    "https://drakonsystems.com/agent-optimizer/success?session_id={CHECKOUT_SESSION_ID}",
    "https://drakonsystems.com/agent-optimizer"
  );

  json(res, 200, { url: session.url });
}

// --- Server ---

const server = createServer(async (req, res) => {
  try {
    const url = req.url ?? "/";

    if (req.method === "POST" && url === "/api/agent-optimizer/webhook") {
      await handleWebhook(req, res);
    } else if (
      req.method === "POST" &&
      url === "/api/agent-optimizer/activate"
    ) {
      await handleActivation(req, res);
    } else if (
      req.method === "POST" &&
      url === "/api/agent-optimizer/checkout"
    ) {
      await handleCreateCheckout(req, res);
    } else if (req.method === "GET" && url === "/api/agent-optimizer/health") {
      json(res, 200, { status: "ok", product: "agent-optimizer" });
    } else {
      json(res, 404, { error: "Not found" });
    }
  } catch (e) {
    console.error("Server error:", e);
    json(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Agent Optimizer licensing server running on port ${PORT}`);
  console.log(`Webhook: POST /api/agent-optimizer/webhook`);
  console.log(`Activate: POST /api/agent-optimizer/activate`);
  console.log(`Checkout: POST /api/agent-optimizer/checkout`);
  console.log(`Health: GET /api/agent-optimizer/health`);
});
