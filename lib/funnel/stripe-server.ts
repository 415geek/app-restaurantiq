import Stripe from 'stripe';

let stripeSingleton: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeSingleton) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }
    stripeSingleton = new Stripe(key, {
      maxNetworkRetries: 3,
      timeout: 30000,
    });
  }
  return stripeSingleton;
}
