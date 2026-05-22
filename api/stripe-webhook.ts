import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import QRCode from 'qrcode';

export const config = { api: { bodyParser: false } };

type Club = 'arty' | 'cure' | 'both';

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

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  const chunks: Buffer[] = [];
  for await (const chunk of req as unknown as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function clubFromSubscription(subscription: Stripe.Subscription): Club | null {
  const item = subscription.items?.data?.[0];
  if (!item) return null;
  const price = item.price as Stripe.Price | undefined;
  let club = price?.metadata?.club as string | undefined;
  if (!club && price?.product && typeof price.product !== 'string') {
    const product = price.product as Stripe.Product | Stripe.DeletedProduct;
    if (!(product as Stripe.DeletedProduct).deleted) {
      club = ((product as Stripe.Product).metadata as Record<string, string> | undefined)?.club;
    }
  }
  if (club === 'arty' || club === 'cure' || club === 'both') return club;
  return null;
}

function asString(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  return v.id ?? null;
}

function clubDisplayName(club: Club): string {
  if (club === 'arty') return 'Arty Club';
  if (club === 'cure') return 'CURE Club';
  return 'Arty Club & CURE Club';
}

function welcomeOpeningLine(club: Club, firstName: string): string {
  if (club === 'arty') return `Welcome to the Arty Club, ${firstName}.`;
  if (club === 'cure') return `Welcome to the CURE Club, ${firstName}.`;
  return `Welcome to the Arty Club and CURE Club, ${firstName}.`;
}

function welcomeSubject(club: Club, firstName: string): string {
  if (club === 'both') return `Welcome to the Clubs, ${firstName}`;
  return `Welcome to the ${clubDisplayName(club)}, ${firstName}`;
}

const BENEFIT_BULLETS = [
  '10% off all food and drink at the Artyst — show this email or your member number at the bar.',
  'Member pricing on every event we run — look for the "members £X" line on event pages.',
  '5-day priority booking on capacity events.',
  'One free guest pass per month.',
  'The right to host your own event at the Artyst under house terms — get in touch when you have something in mind.',
];

const BOTH_EXTRA_BULLET =
  "Full access to both clubs' programmes wherever they're held in the building.";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildWelcomeEmail(opts: {
  club: Club;
  firstName: string;
  memberNumber: string;
  siteUrl: string;
}) {
  const { club, firstName, memberNumber, siteUrl } = opts;
  const opening = welcomeOpeningLine(club, firstName);
  const bullets = [...BENEFIT_BULLETS];
  if (club === 'both') bullets.push(BOTH_EXTRA_BULLET);

  const textBullets = bullets.map((b) => `· ${b}`).join('\n');
  const text = [
    opening,
    '',
    `You're member ${memberNumber}. Here's what that means in practice:`,
    '',
    textBullets,
    '',
    'Your QR code (attached) does the same job as your member number — easier to show on your phone than to remember.',
    '',
    'To manage your subscription, change your card details, or switch clubs, use this link any time:',
    `${siteUrl}/manage`,
    '',
    'Welcome in.',
    '',
    'Matthew',
    'The Artyst · 54-56 Chesterton Road · Cambridge CB4 1EN',
  ].join('\n');

  const htmlBullets = bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('');
  const html = `<!doctype html>
<html><body style="font-family: Georgia, serif; color: #1a1714; line-height: 1.55; max-width: 600px;">
<p>${escapeHtml(opening)}</p>
<p>You're member <strong>${escapeHtml(memberNumber)}</strong>. Here's what that means in practice:</p>
<ul>${htmlBullets}</ul>
<p>Your QR code <img src="cid:member-qr" alt="QR code for ${escapeHtml(memberNumber)}" style="vertical-align: middle; width: 24px; height: 24px;" /> (attached) does the same job as your member number — easier to show on your phone than to remember.</p>
<p>To manage your subscription, change your card details, or switch clubs, use this link any time:<br/>
<a href="${escapeHtml(siteUrl)}/manage">${escapeHtml(siteUrl)}/manage</a></p>
<p>Welcome in.</p>
<p>Matthew<br/>The Artyst · 54-56 Chesterton Road · Cambridge CB4 1EN</p>
</body></html>`;

  return { text, html };
}

async function buildQrAttachment(memberNumber: string) {
  const buffer = await QRCode.toBuffer(memberNumber, { width: 320, margin: 1 });
  return {
    filename: `${memberNumber}.png`,
    content: buffer,
    contentType: 'image/png',
    contentId: 'member-qr',
  };
}

async function alreadyProcessed(eventId: string): Promise<boolean> {
  const { data } = await getSupabase()
    .from('membership_events')
    .select('id')
    .contains('metadata', { stripe_event_id: eventId })
    .limit(1);
  return !!(data && data.length > 0);
}

async function recordEvent(eventId: string, memberEmail: string, eventType: string, extra: Record<string, unknown> = {}) {
  await getSupabase().from('membership_events').insert({
    member_email: memberEmail,
    event_type: eventType,
    source: 'stripe_webhook',
    metadata: { stripe_event_id: eventId, ...extra },
  });
}

async function handleCheckoutCompleted(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  const email = session.customer_email;
  const subscriptionId = asString(session.subscription as any);
  const stripeCustomerId = asString(session.customer as any);
  const sessionMeta = (session.metadata as Record<string, string> | null) ?? {};
  const name = sessionMeta.name ?? 'Member';

  if (!email || !subscriptionId) return;

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price.product'],
  });
  const club = clubFromSubscription(subscription);
  if (!club) return;

  const now = new Date().toISOString();
  const update: Record<string, any> = {
    email,
    name,
    stripe_customer_id: stripeCustomerId,
    marketing_consent: sessionMeta.marketing_consent === 'true',
    signup_message: sessionMeta.signup_message || null,
  };
  if (club === 'arty' || club === 'both') {
    update.arty_active = true;
    update.arty_joined_at = now;
    update.stripe_arty_subscription_id = subscriptionId;
  }
  if (club === 'cure' || club === 'both') {
    update.cure_active = true;
    update.cure_joined_at = now;
    update.stripe_cure_subscription_id = subscriptionId;
  }

  const supabase = getSupabase();
  const { data: row, error } = await supabase
    .from('members')
    .upsert(update, { onConflict: 'email' })
    .select('member_number, name')
    .single();
  if (error || !row) throw error ?? new Error('upsert_failed');

  const eventType =
    club === 'arty' ? 'joined_arty' : club === 'cure' ? 'joined_cure' : 'joined_both';
  await recordEvent(event.id, email, eventType, { club });

  try {
    const firstName = (row.name ?? '').trim().split(/\s+/)[0] || 'there';
    const siteUrl = process.env.SITE_URL ?? 'https://member.theartyst.co.uk';
    const memberNumber = row.member_number as string;
    const { text, html } = buildWelcomeEmail({
      club,
      firstName,
      memberNumber,
      siteUrl,
    });
    const attachment = await buildQrAttachment(memberNumber);
    await getResend().emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: email,
      replyTo: 'matthew@othersyde.co.uk',
      subject: welcomeSubject(club, firstName),
      text,
      html,
      attachments: [attachment],
    });
  } catch (err) {
    console.error('Welcome email failed', err);
  }
}

async function handleSubscriptionCreated(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const stripeCustomerId = asString(subscription.customer as any);
  if (!stripeCustomerId) return;

  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from('members')
    .select('email')
    .eq('stripe_customer_id', stripeCustomerId)
    .limit(1);
  if (existing && existing.length > 0) return;

  const club = clubFromSubscription(subscription);
  if (!club) return;

  const customerResp = await getStripe().customers.retrieve(stripeCustomerId);
  if (!customerResp || (customerResp as Stripe.DeletedCustomer).deleted) return;
  const customer = customerResp as Stripe.Customer;

  const email = customer.email;
  const subMeta = (subscription.metadata as Record<string, string> | null) ?? {};
  const name = customer.name ?? subMeta.name ?? 'Member';
  if (!email) return;

  const now = new Date().toISOString();
  const update: Record<string, any> = {
    email,
    name,
    stripe_customer_id: stripeCustomerId,
  };
  if (club === 'arty' || club === 'both') {
    update.arty_active = true;
    update.arty_joined_at = now;
    update.stripe_arty_subscription_id = subscription.id;
  }
  if (club === 'cure' || club === 'both') {
    update.cure_active = true;
    update.cure_joined_at = now;
    update.stripe_cure_subscription_id = subscription.id;
  }
  await supabase.from('members').upsert(update, { onConflict: 'email' });
}

async function handleSubscriptionUpdated(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const stripeCustomerId = asString(subscription.customer as any);
  if (!stripeCustomerId) return;
  const newClub = clubFromSubscription(subscription);
  if (!newClub) return;

  const supabase = getSupabase();
  const { data: member } = await supabase
    .from('members')
    .select('email, arty_active, cure_active')
    .eq('stripe_customer_id', stripeCustomerId)
    .single();
  if (!member) return;

  const oldArty = !!member.arty_active;
  const oldCure = !!member.cure_active;
  const newArty = newClub === 'arty' || newClub === 'both';
  const newCure = newClub === 'cure' || newClub === 'both';
  if (oldArty === newArty && oldCure === newCure) return;

  const now = new Date().toISOString();
  const update: Record<string, any> = {
    arty_active: newArty,
    cure_active: newCure,
  };
  if (newArty && !oldArty) update.arty_joined_at = now;
  if (newCure && !oldCure) update.cure_joined_at = now;
  if (!newArty && oldArty) update.arty_cancelled_at = now;
  if (!newCure && oldCure) update.cure_cancelled_at = now;
  if (newClub === 'arty' || newClub === 'both') update.stripe_arty_subscription_id = subscription.id;
  if (newClub === 'cure' || newClub === 'both') update.stripe_cure_subscription_id = subscription.id;

  await supabase.from('members').update(update).eq('email', member.email);

  const oldCount = (oldArty ? 1 : 0) + (oldCure ? 1 : 0);
  const newCount = (newArty ? 1 : 0) + (newCure ? 1 : 0);
  let eventType: string | null = null;
  if (oldCount === 1 && newCount === 2) eventType = 'switched_to_both';
  else if (oldCount === 2 && newCount === 1) eventType = 'switched_to_solo';

  if (eventType) {
    await recordEvent(event.id, member.email, eventType, { club: newClub });
  }
}

async function handleSubscriptionDeleted(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const stripeCustomerId = asString(subscription.customer as any);
  if (!stripeCustomerId) return;
  const club = clubFromSubscription(subscription);
  if (!club) return;

  const supabase = getSupabase();
  const { data: member } = await supabase
    .from('members')
    .select('email')
    .eq('stripe_customer_id', stripeCustomerId)
    .single();
  if (!member) return;

  const now = new Date().toISOString();
  const update: Record<string, any> = {};
  if (club === 'arty' || club === 'both') {
    update.arty_active = false;
    update.arty_cancelled_at = now;
  }
  if (club === 'cure' || club === 'both') {
    update.cure_active = false;
    update.cure_cancelled_at = now;
  }
  await supabase.from('members').update(update).eq('email', member.email);

  const eventType =
    club === 'arty' ? 'cancelled_arty' : club === 'cure' ? 'cancelled_cure' : 'cancelled_both';
  await recordEvent(event.id, member.email, eventType, { club });
}

async function handleInvoicePaymentFailed(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  const stripeCustomerId = asString(invoice.customer as any);
  if (!stripeCustomerId) return;

  const supabase = getSupabase();
  const { data: member } = await supabase
    .from('members')
    .select('email')
    .eq('stripe_customer_id', stripeCustomerId)
    .single();
  if (!member) return;

  await recordEvent(event.id, member.email, 'payment_failed', { invoice_id: invoice.id });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const sigHeader = req.headers['stripe-signature'];
  const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
  if (!signature) {
    return res.status(400).json({ error: 'missing_signature' });
  }

  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req);
  } catch {
    return res.status(400).json({ error: 'invalid_body' });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch {
    return res.status(400).json({ error: 'invalid_signature' });
  }

  if (await alreadyProcessed(event.id)) {
    return res.status(200).json({ received: true, idempotent: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event);
        break;
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event);
        break;
      default:
        break;
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error', err);
    return res.status(500).json({ error: 'handler_failed' });
  }
}
