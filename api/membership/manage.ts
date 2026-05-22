import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (_stripe) return _stripe;
  _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  return _stripe;
}

let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  _supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _supabase;
}

export function __setStripeForTests(client: Stripe | null) { _stripe = client; }
export function __setSupabaseForTests(client: SupabaseClient | null) { _supabase = client; }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const email = body.email;
  if (typeof email !== 'string' || email.length === 0 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  const { data, error } = await getSupabase()
    .from('members')
    .select('stripe_customer_id')
    .ilike('email', email)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: 'lookup_failed' });
  }

  const customerId = data?.stripe_customer_id;
  if (!customerId) {
    return res.status(404).json({ error: 'member_not_found' });
  }

  const siteUrl = process.env.SITE_URL ?? 'https://member.theartyst.co.uk';

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${siteUrl}/manage`,
    });
    return res.status(200).json({ url: session.url });
  } catch {
    return res.status(500).json({ error: 'portal_create_failed' });
  }
}
