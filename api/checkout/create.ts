import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PRICE_ENV_BY_PRODUCT = {
  arty: 'STRIPE_PRICE_ARTY',
  cure: 'STRIPE_PRICE_CURE',
  // 'both' retired in v2 — the Both Clubs SKU no longer accepts new checkouts,
  // so product: 'both' now falls through to a 400 invalid_product. Historical
  // Both subscriptions are still handled by api/stripe-webhook.ts.
} as const;

type Product = keyof typeof PRICE_ENV_BY_PRODUCT;

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (_stripe) return _stripe;
  _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  return _stripe;
}

export function __setStripeForTests(client: Stripe | null) {
  _stripe = client;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const product = body.product;
  const name = body.name;
  const email = body.email;
  const signupMessage = body.signup_message;
  const marketingConsent = body.marketing_consent;

  if (typeof product !== 'string' || product.length === 0) {
    return res.status(400).json({ error: 'missing_field' });
  }
  if (!(product in PRICE_ENV_BY_PRODUCT)) {
    return res.status(400).json({ error: 'invalid_product' });
  }
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
    return res.status(400).json({ error: 'missing_field' });
  }
  if (typeof email !== 'string' || email.length === 0) {
    return res.status(400).json({ error: 'missing_field' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'invalid_email' });
  }
  if (signupMessage !== undefined && (typeof signupMessage !== 'string' || signupMessage.length > 500)) {
    return res.status(400).json({ error: 'missing_field' });
  }

  const priceEnvVar = PRICE_ENV_BY_PRODUCT[product as Product];
  const priceId = process.env[priceEnvVar];
  if (!priceId) {
    return res.status(500).json({ error: 'price_not_configured' });
  }

  const siteUrl = process.env.SITE_URL ?? 'https://member.theartyst.co.uk';
  const consent = marketingConsent === true;
  const message = typeof signupMessage === 'string' ? signupMessage : '';

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/`,
      metadata: {
        name,
        email,
        club: product,
        signup_message: message,
        marketing_consent: String(consent),
      },
      subscription_data: {
        metadata: {
          club: product,
          name,
          email,
        },
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: 'checkout_create_failed' });
  }
}
