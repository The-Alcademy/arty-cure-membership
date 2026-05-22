import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const raw = req.query.session_id;
  const sessionId = Array.isArray(raw) ? raw[0] : raw;
  if (!sessionId || typeof sessionId !== 'string' || sessionId.length === 0) {
    return res.status(400).json({ error: 'invalid_session_id' });
  }

  let email: string | null = null;
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    email = session.customer_email ?? null;
    if (!email && session.customer_details && typeof session.customer_details === 'object') {
      email = (session.customer_details as { email?: string | null }).email ?? null;
    }
  } catch {
    return res.status(400).json({ error: 'invalid_session_id' });
  }

  if (!email) {
    return res.status(200).json({ ready: false });
  }

  const { data, error } = await getSupabase().rpc('is_active_member', { p_email: email });
  if (error) {
    return res.status(500).json({ error: 'lookup_failed' });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.is_member) {
    return res.status(200).json({ ready: false });
  }

  return res.status(200).json({
    ready: true,
    name: row.name,
    member_number: row.member_number,
    arty: !!row.arty,
    cure: !!row.cure,
  });
}
