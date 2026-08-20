import Stripe from "stripe";

export type StripeGateway = {
  checkout: Stripe["checkout"];
  webhooks: Stripe["webhooks"];
};

export function createStripeGateway(
  apiKey = process.env.STRIPE_API_KEY,
): StripeGateway | null {
  if (!apiKey) {
    return null;
  }

  return new Stripe(apiKey, {
    appInfo: {
      name: "ZEROFAYYZ FINTECH Portfolio Prototype",
      version: "0.2.0",
    },
  });
}
