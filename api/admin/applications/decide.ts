// ─────────────────────────────────────────────────────────────────
// api/admin/applications/decide.ts
//
// Records an accept / reject decision on one CURE Club application.
//
//   POST /api/admin/applications/decide
//   body: { application_id: uuid, decision: 'accept' | 'reject', notes?: string }
//
// Accept → flips the application to 'accepted', creates a Stripe Checkout
//          session for the £50 CURE subscription (STRIPE_PRICE_CURE) carrying
//          metadata.cure_application_id so the webhook can link the eventual
//          member row back to this application, stores the session URL on the
//          row (for resend-on-request), and emails the applicant the link.
//          Returns 200 { application_id, status, checkout_session_url }.
//
// Reject → flips the application to 'rejected' and sends a short, respectful
//          email. Returns 200 { application_id, status }.
//
// Auth: Authorization: Bearer <ADMIN_TOKEN>  (see api/_lib/adminAuth.ts)
//
// Errors: 401 bad auth · 404 not found · 409 already decided ·
//         400 bad body · 500 on stripe / email / db failure.
// ─────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { checkAdminAuth } from '../../_lib/adminAuth.js';

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

type ResendLike = { emails: { send: (args: any) => Promise<any> } };
let _resend: ResendLike | null = null;
function getResend(): ResendLike {
  if (_resend) return _resend;
  _resend = new Resend(process.env.RESEND_API_KEY!) as unknown as ResendLike;
  return _resend;
}

export function __setStripeForTests(client: Stripe | null) { _stripe = client; }
export function __setSupabaseForTests(client: SupabaseClient | null) { _supabase = client; }
export function __setResendForTests(client: ResendLike | null) { _resend = client; }

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || 'there';
}

// "You're in — here's the link" email. Warm, concrete, no false urgency.
// The member number + full benefits land in the CURE welcome email that the
// webhook sends once payment completes (spec §7.2); this is the bridge to it.
function buildAcceptEmail(opts: { firstName: string; checkoutUrl: string }) {
  const { firstName, checkoutUrl } = opts;
  const text = [
    `${firstName}, you're in.`,
    '',
    "I've read your application and I'd like you in the CURE Club. The last step is setting up your membership — £50 a month — which starts the moment you complete it here:",
    '',
    checkoutUrl,
    '',
    "Once that's done you'll get your member number and everything that comes with it. There's more I want to say in person about what CURE is becoming — that conversation is soon.",
    '',
    'Welcome in.',
    '',
    'Matthew',
    'The Artyst · 54-56 Chesterton Road · Cambridge CB4 1EN',
  ].join('\n');

  const html = `<!doctype html>
<html><body style="font-family: Georgia, serif; color: #1a1714; line-height: 1.55; max-width: 600px;">
<p>${escapeHtml(firstName)}, you're in.</p>
<p>I've read your application and I'd like you in the CURE Club. The last step is setting up your membership — £50 a month — which starts the moment you complete it here:</p>
<p><a href="${escapeHtml(checkoutUrl)}">${escapeHtml(checkoutUrl)}</a></p>
<p>Once that's done you'll get your member number and everything that comes with it. There's more I want to say in person about what CURE is becoming — that conversation is soon.</p>
<p>Welcome in.</p>
<p>Matthew<br/>The Artyst · 54-56 Chesterton Road · Cambridge CB4 1EN</p>
</body></html>`;

  return { text, html };
}

// Reject email. Short, respectful, explicitly not a comment on the person,
// and it keeps the Arty Club door open. Deliberately un-templated in feel.
function buildRejectEmail(opts: { firstName: string }) {
  const { firstName } = opts;
  const text = [
    `${firstName},`,
    '',
    'Thank you for applying to the CURE Club, and for the care you put into it — I read every word.',
    '',
    "I'm not able to offer you a place this time. That isn't a judgement on you or your work; CURE is a small room, and the decisions come down to fit and timing far more than merit — and I'm still learning how to make them well.",
    '',
    'The Arty Club stays open to you — the run of the building and everything membership carries — and you would be welcome to apply to CURE again further down the line.',
    '',
    'With real thanks,',
    '',
    'Matthew',
    'The Artyst · 54-56 Chesterton Road · Cambridge CB4 1EN',
  ].join('\n');

  const html = `<!doctype html>
<html><body style="font-family: Georgia, serif; color: #1a1714; line-height: 1.55; max-width: 600px;">
<p>${escapeHtml(firstName)},</p>
<p>Thank you for applying to the CURE Club, and for the care you put into it — I read every word.</p>
<p>I'm not able to offer you a place this time. That isn't a judgement on you or your work; CURE is a small room, and the decisions come down to fit and timing far more than merit — and I'm still learning how to make them well.</p>
<p>The Arty Club stays open to you — the run of the building and everything membership carries — and you would be welcome to apply to CURE again further down the line.</p>
<p>With real thanks,</p>
<p>Matthew<br/>The Artyst · 54-56 Chesterton Road · Cambridge CB4 1EN</p>
</body></html>`;

  return { text, html };
}

type ApplicationRow = {
  id: string;
  email: string;
  name: string;
  status: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!checkAdminAuth(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const applicationId = body.application_id;
  const decision = body.decision;
  const notes = body.notes;

  if (typeof applicationId !== 'string' || applicationId.trim().length === 0) {
    return res.status(400).json({ error: 'application_id_required' });
  }
  if (decision !== 'accept' && decision !== 'reject') {
    return res.status(400).json({ error: 'invalid_decision' });
  }
  if (notes !== undefined && typeof notes !== 'string') {
    return res.status(400).json({ error: 'invalid_notes' });
  }

  const decidedBy = typeof body.decided_by === 'string' && body.decided_by.trim().length > 0
    ? body.decided_by.trim()
    : 'admin';
  const decisionNotes = typeof notes === 'string' && notes.trim().length > 0 ? notes.trim() : null;

  const supabase = getSupabase();

  // ── Load + guard ────────────────────────────────────────────────────────
  const { data: found, error: loadErr } = await supabase
    .from('cure_applications')
    .select('id, email, name, status')
    .eq('id', applicationId)
    .limit(1);
  if (loadErr) {
    console.error('decide load error:', loadErr);
    return res.status(500).json({ error: 'load_failed' });
  }
  if (!found?.length) {
    return res.status(404).json({ error: 'not_found' });
  }
  const application = found[0] as ApplicationRow;
  if (application.status !== 'pending') {
    return res.status(409).json({ error: 'already_decided', status: application.status });
  }

  const decidedAt = new Date().toISOString();
  const fromEmail = process.env.RESEND_FROM_EMAIL!;
  const firstName = firstNameOf(application.name);

  // ── Reject path ───────────────────────────────────────────────────────────
  if (decision === 'reject') {
    const { error: updErr } = await supabase
      .from('cure_applications')
      .update({
        status: 'rejected',
        decided_at: decidedAt,
        decided_by: decidedBy,
        decision_notes: decisionNotes,
      })
      .eq('id', application.id);
    if (updErr) {
      console.error('decide reject update error:', updErr);
      return res.status(500).json({ error: 'update_failed' });
    }

    try {
      const email = buildRejectEmail({ firstName });
      await getResend().emails.send({
        from: fromEmail,
        to: application.email,
        replyTo: 'matthew@othersyde.co.uk',
        subject: 'About your CURE Club application',
        text: email.text,
        html: email.html,
      });
    } catch (err) {
      console.error('decide reject email failed', err);
      return res.status(500).json({ error: 'email_failed' });
    }

    return res.status(200).json({ application_id: application.id, status: 'rejected' });
  }

  // ── Accept path ───────────────────────────────────────────────────────────
  const priceId = process.env.STRIPE_PRICE_CURE;
  if (!priceId) {
    return res.status(500).json({ error: 'price_not_configured' });
  }
  const siteUrl = process.env.SITE_URL ?? 'https://member.theartyst.co.uk';

  let checkoutUrl: string | null = null;
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      customer_email: application.email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/`,
      metadata: {
        name: application.name,
        email: application.email,
        club: 'cure',
        cure_application_id: application.id,
      },
      subscription_data: {
        metadata: {
          club: 'cure',
          name: application.name,
          email: application.email,
          cure_application_id: application.id,
        },
      },
    });
    checkoutUrl = session.url ?? null;
  } catch (err) {
    console.error('decide accept stripe error', err);
    return res.status(500).json({ error: 'checkout_failed' });
  }
  if (!checkoutUrl) {
    return res.status(500).json({ error: 'checkout_failed' });
  }

  const { error: updErr } = await supabase
    .from('cure_applications')
    .update({
      status: 'accepted',
      decided_at: decidedAt,
      decided_by: decidedBy,
      decision_notes: decisionNotes,
      checkout_session_url: checkoutUrl,
    })
    .eq('id', application.id);
  if (updErr) {
    console.error('decide accept update error:', updErr);
    return res.status(500).json({ error: 'update_failed' });
  }

  try {
    const email = buildAcceptEmail({ firstName, checkoutUrl });
    await getResend().emails.send({
      from: fromEmail,
      to: application.email,
      replyTo: 'matthew@othersyde.co.uk',
      subject: 'Welcome to the CURE Club — payment link inside',
      text: email.text,
      html: email.html,
    });
  } catch (err) {
    console.error('decide accept email failed', err);
    return res.status(500).json({ error: 'email_failed' });
  }

  return res.status(200).json({
    application_id: application.id,
    status: 'accepted',
    checkout_session_url: checkoutUrl,
  });
}
