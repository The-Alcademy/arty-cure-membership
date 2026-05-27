// ─────────────────────────────────────────────────────────────────
// api/membership/cancel.ts
//
// Cancel a member's active subscription(s) at period end. Used by the
// /manage page's in-context cancel flow (Option B). Auth is the same
// magic-link token the PWA pass uses.
//
// Usage:
//   POST /api/membership/cancel  { token: "<signed-token>" }
//
// Behaviour:
//   - Verify the token via verifyToken; resolve to a member_number.
//   - Look up the member.
//   - For every active subscription on the member
//     (stripe_arty_subscription_id / stripe_cure_subscription_id), call
//     Stripe with cancel_at_period_end=true. The webhook ultimately
//     flips arty_active / cure_active to false when the period ends.
//     We record the cancellation timestamps now from Stripe's response
//     so the UI can show "active until <date>" immediately.
//
// Returns:
//   200 { period_end: "<ISO>", cancelled_arty: boolean, cancelled_cure: boolean }
//       period_end is the latest period_end across all subscriptions we
//       touched. null if no subscription was active.
//   400 token_required if body lacks a token
//   401 invalid_token
//   404 member_not_found
//   409 nothing_to_cancel if the member is already cancelled / has no
//       Stripe subscription IDs (defensive — UI shouldn't offer cancel
//       in this state, but the API stays consistent).
//   500 on Stripe / Supabase errors
// ─────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { verifyToken } from '../_lib/memberToken.js';

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

type MemberRow = {
  member_number:                 string;
  arty_active:                   boolean | null;
  cure_active:                   boolean | null;
  stripe_arty_subscription_id:   string | null;
  stripe_cure_subscription_id:   string | null;
};

// Stripe returns current_period_end as a unix-seconds integer on the
// Subscription resource. We accept either that shape or a string ISO date
// (forgiving so tests don't have to faithfully mock unix timestamps).
function toIsoPeriodEnd(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === 'string' && value.length > 0) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const token = typeof body.token === 'string' ? body.token : null;
  if (!token) {
    return res.status(400).json({ error: 'token_required' });
  }

  const memberNumber = verifyToken(token);
  if (!memberNumber) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  const { data, error } = await getSupabase()
    .from('members')
    .select(
      'member_number, arty_active, cure_active, stripe_arty_subscription_id, stripe_cure_subscription_id',
    )
    .eq('member_number', memberNumber)
    .limit(1);

  if (error) {
    console.error('member fetch error:', error);
    return res.status(500).json({ error: 'lookup_failed' });
  }
  if (!data?.length) {
    return res.status(404).json({ error: 'member_not_found' });
  }
  const member = data[0] as MemberRow;

  const toCancel: Array<{
    kind:           'arty' | 'cure';
    subscriptionId: string;
  }> = [];
  if (member.arty_active && member.stripe_arty_subscription_id) {
    toCancel.push({ kind: 'arty', subscriptionId: member.stripe_arty_subscription_id });
  }
  if (member.cure_active && member.stripe_cure_subscription_id) {
    toCancel.push({ kind: 'cure', subscriptionId: member.stripe_cure_subscription_id });
  }

  if (toCancel.length === 0) {
    return res.status(409).json({ error: 'nothing_to_cancel' });
  }

  let latestPeriodEnd: string | null = null;
  let cancelledArty = false;
  let cancelledCure = false;
  const stripe = getStripe();

  for (const sub of toCancel) {
    let updated: Stripe.Subscription;
    try {
      updated = await stripe.subscriptions.update(sub.subscriptionId, {
        cancel_at_period_end: true,
      });
    } catch (e: any) {
      console.error('stripe cancel error:', sub.subscriptionId, e?.message);
      return res.status(500).json({ error: 'stripe_cancel_failed' });
    }

    const periodEnd = toIsoPeriodEnd(
      (updated as unknown as { current_period_end?: unknown }).current_period_end,
    );
    if (periodEnd && (!latestPeriodEnd || periodEnd > latestPeriodEnd)) {
      latestPeriodEnd = periodEnd;
    }
    if (sub.kind === 'arty') cancelledArty = true;
    else cancelledCure = true;
  }

  // Stamp cancellation timestamps. We DON'T flip *_active here — the
  // Stripe webhook handler does that when the period actually ends, so
  // the member retains access until then.
  const patch: Record<string, string> = {};
  if (cancelledArty && latestPeriodEnd) patch.arty_cancelled_at = latestPeriodEnd;
  if (cancelledCure && latestPeriodEnd) patch.cure_cancelled_at = latestPeriodEnd;
  if (Object.keys(patch).length > 0) {
    const { error: updErr } = await getSupabase()
      .from('members')
      .update(patch)
      .eq('member_number', memberNumber);
    if (updErr) {
      // The Stripe-side cancellation already succeeded; log but don't
      // 500 — the webhook will reconcile state when the period ends.
      console.error('members update error after cancel:', updErr);
    }
  }

  return res.status(200).json({
    period_end:      latestPeriodEnd,
    cancelled_arty:  cancelledArty,
    cancelled_cure:  cancelledCure,
  });
}
