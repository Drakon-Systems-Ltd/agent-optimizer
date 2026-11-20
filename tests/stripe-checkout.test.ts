import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import { createCheckoutSession, PRICING } from "../src/licensing/stripe.js";

// A fake client that records the params instead of calling Stripe.
function fakeStripe() {
  const create = vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => ({ id: "cs_test", params }));
  const stripe = { checkout: { sessions: { create } } } as unknown as Stripe;
  return { stripe, create };
}

describe("createCheckoutSession (#2)", () => {
  it.each(PRICING.map((t) => [t.id, t] as const))(
    "disables Adaptive Pricing and charges the GBP catalog price for %s",
    async (_id, tier) => {
      const { stripe, create } = fakeStripe();
      await createCheckoutSession(stripe, tier, "buyer@example.com", "https://example.com/ok", "https://example.com/cancel");
      expect(create).toHaveBeenCalledTimes(1);
      const params = create.mock.calls[0][0];
      expect(params.adaptive_pricing).toEqual({ enabled: false });
      expect(params.mode).toBe("payment");
      expect(params.line_items).toHaveLength(1);
      const priceData = params.line_items![0].price_data!;
      expect(priceData.currency).toBe("gbp");
      expect(priceData.unit_amount).toBe(tier.price);
    },
  );

  it("keeps the catalog at the three GBP prices with no other currency", () => {
    expect(PRICING.map((t) => [t.id, t.price, t.currency])).toEqual([
      ["solo", 2900, "gbp"],
      ["fleet", 7900, "gbp"],
      ["lifetime", 14900, "gbp"],
    ]);
  });
});
