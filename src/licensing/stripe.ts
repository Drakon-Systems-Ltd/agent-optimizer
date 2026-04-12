import Stripe from "stripe";

const PRODUCT_NAME = "Agent Optimizer by Drakon Systems";

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
}

export interface PricingTier {
  id: string;
  name: string;
  price: number; // in pence/cents
  currency: string;
  tier: "solo" | "fleet" | "lifetime";
  description: string;
}

export const PRICING: PricingTier[] = [
  {
    id: "solo",
    name: "Solo License",
    price: 2900,
    currency: "gbp",
    tier: "solo",
    description: "Single machine: audit, optimize, and scan",
  },
  {
    id: "fleet",
    name: "Fleet License",
    price: 7900,
    currency: "gbp",
    tier: "fleet",
    description: "Multi-host fleet audit + everything in Solo",
  },
  {
    id: "lifetime",
    name: "Lifetime License",
    price: 14900,
    currency: "gbp",
    tier: "lifetime",
    description: "Fleet + 12 months updates + priority support",
  },
];

/**
 * Create a Stripe checkout session for a one-off payment.
 */
export async function createCheckoutSession(
  stripe: Stripe,
  tier: PricingTier,
  customerEmail: string,
  successUrl: string,
  cancelUrl: string
): Promise<Stripe.Checkout.Session> {
  return stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: customerEmail,
    line_items: [
      {
        price_data: {
          currency: tier.currency,
          product_data: {
            name: `${PRODUCT_NAME} — ${tier.name}`,
            description: tier.description,
            metadata: { tier: tier.tier },
          },
          unit_amount: tier.price,
        },
        quantity: 1,
      },
    ],
    metadata: {
      product: "agent-optimizer",
      tier: tier.tier,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

/**
 * Verify a Stripe webhook signature.
 */
export function verifyWebhookSignature(
  stripe: Stripe,
  payload: string | Buffer,
  signature: string,
  webhookSecret: string
): Stripe.Event {
  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}
