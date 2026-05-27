import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import questions from '../_lib/apply-questions.json';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Canonical question set lives in api/_lib/apply-questions.json so the page,
// this endpoint, and the admin notification all share one source of truth.
const QUESTIONS = questions as Array<{
  id: string;
  label: string;
  helper_text: string;
  max_chars: number;
  required: boolean;
}>;
const REQUIRED_QUESTION_IDS = QUESTIONS.filter((q) => q.required).map((q) => q.id);

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

// Warm, concrete, no false urgency — matches the tone of buildWelcomeEmail in
// api/stripe-webhook.ts.
function buildApplicantEmail() {
  const text = [
    "Thanks for applying to the CURE Club. I've got your application.",
    '',
    "I'll be in touch within a week — probably sooner — to find a time for the conversation. It's 45 minutes or so, at the Artyst, no pressure either way.",
    '',
    "If you don't hear from me within 10 days, please nudge me at matthew@othersyde.co.uk.",
    '',
    'Matthew',
    'The Artyst · 54-56 Chesterton Road · Cambridge CB4 1EN',
  ].join('\n');

  const html = `<!doctype html>
<html><body style="font-family: Georgia, serif; color: #1a1714; line-height: 1.55; max-width: 600px;">
<p>Thanks for applying to the CURE Club. I've got your application.</p>
<p>I'll be in touch within a week — probably sooner — to find a time for the conversation. It's 45 minutes or so, at the Artyst, no pressure either way.</p>
<p>If you don't hear from me within 10 days, please nudge me at <a href="mailto:matthew@othersyde.co.uk">matthew@othersyde.co.uk</a>.</p>
<p>Matthew<br/>The Artyst · 54-56 Chesterton Road · Cambridge CB4 1EN</p>
</body></html>`;

  return { text, html };
}

function buildAdminEmail(opts: {
  name: string;
  email: string;
  questionnaire: Record<string, unknown>;
  existingMemberEmail: string | null;
  createdAt: string;
  siteUrl: string;
}) {
  const { name, email, questionnaire, existingMemberEmail, createdAt, siteUrl } = opts;
  const applicationsUrl = `${siteUrl}/admin/applications`;

  const qaLines: string[] = [];
  const qaHtml: string[] = [];
  for (const q of QUESTIONS) {
    const raw = questionnaire[q.id];
    const answer = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : '(no answer)';
    qaLines.push(q.label, answer, '');
    qaHtml.push(
      `<p style="margin:16px 0 4px;font-weight:bold;">${escapeHtml(q.label)}</p>` +
        `<p style="margin:0;white-space:pre-wrap;">${escapeHtml(answer)}</p>`,
    );
  }

  const upgradeNote = existingMemberEmail
    ? `Existing member: ${existingMemberEmail} (upgrade candidate)`
    : 'No existing membership on record.';
  const upgradeNoteHtml = existingMemberEmail
    ? `<p><strong>Existing member:</strong> ${escapeHtml(existingMemberEmail)} (upgrade candidate)</p>`
    : `<p>No existing membership on record.</p>`;

  const text = [
    `New CURE Club application from ${name}.`,
    '',
    `Name:      ${name}`,
    `Email:     ${email}`,
    `Submitted: ${createdAt}`,
    upgradeNote,
    '',
    '— Application —',
    '',
    ...qaLines,
    `Review: ${applicationsUrl}`,
  ].join('\n');

  const html = `<!doctype html>
<html><body style="font-family: Georgia, serif; color: #1a1714; line-height: 1.55; max-width: 640px;">
<p>New CURE Club application from <strong>${escapeHtml(name)}</strong>.</p>
<p><strong>Email:</strong> ${escapeHtml(email)}<br/><strong>Submitted:</strong> ${escapeHtml(createdAt)}</p>
${upgradeNoteHtml}
<hr/>
${qaHtml.join('\n')}
<hr/>
<p><a href="${escapeHtml(applicationsUrl)}">Review applications</a></p>
</body></html>`;

  return { text, html };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = body.name;
  const email = body.email;
  const questionnaire = body.questionnaire;

  // ── Validation ───────────────────────────────────────────────────────────
  if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 100) {
    return res.status(400).json({ error: 'missing_field' });
  }
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'invalid_email' });
  }
  if (!questionnaire || typeof questionnaire !== 'object' || Array.isArray(questionnaire)) {
    return res.status(400).json({ error: 'questionnaire_incomplete' });
  }
  const answers = questionnaire as Record<string, unknown>;
  for (const id of REQUIRED_QUESTION_IDS) {
    const value = answers[id];
    if (typeof value !== 'string' || value.trim().length === 0) {
      return res.status(400).json({ error: 'questionnaire_incomplete' });
    }
  }

  const cleanName = name.trim();
  const cleanEmail = email.trim();
  const supabase = getSupabase();

  // ── Duplicate guard — one pending application per email ──────────────────
  const { data: pending, error: pendingErr } = await supabase
    .from('cure_applications')
    .select('id')
    .eq('status', 'pending')
    .ilike('email', cleanEmail)
    .limit(1);
  if (pendingErr) {
    console.error('cure_applications duplicate lookup failed', pendingErr);
    return res.status(500).json({ error: 'application_failed' });
  }
  if (pending && pending.length > 0) {
    return res.status(409).json({ application_id: pending[0].id, status: 'pending' });
  }

  // ── Flag upgrade candidates: applicant is already an Arty member ─────────
  let existingMemberEmail: string | null = null;
  const { data: member } = await supabase
    .from('members')
    .select('email')
    .ilike('email', cleanEmail)
    .limit(1);
  if (member && member.length > 0) {
    existingMemberEmail = member[0].email as string;
  }

  // ── Write the application. This is the only failure that fails the request.
  const { data: inserted, error: insertErr } = await supabase
    .from('cure_applications')
    .insert({
      email: cleanEmail,
      name: cleanName,
      questionnaire: answers,
      status: 'pending',
      existing_member_email: existingMemberEmail,
    })
    .select('id, status')
    .single();
  if (insertErr || !inserted) {
    console.error('cure_applications insert failed', insertErr);
    return res.status(500).json({ error: 'application_failed' });
  }

  // ── Notifications are best-effort: the row is already saved, so an email
  //    failure must not turn a successful application into an error.
  try {
    const fromEmail = process.env.RESEND_FROM_EMAIL!;
    const siteUrl = process.env.SITE_URL ?? 'https://member.theartyst.co.uk';

    const applicant = buildApplicantEmail();
    await getResend().emails.send({
      from: fromEmail,
      to: cleanEmail,
      replyTo: 'matthew@othersyde.co.uk',
      subject: 'Your CURE Club application — The Artyst',
      text: applicant.text,
      html: applicant.html,
    });

    const admin = buildAdminEmail({
      name: cleanName,
      email: cleanEmail,
      questionnaire: answers,
      existingMemberEmail,
      createdAt: new Date().toISOString(),
      siteUrl,
    });
    await getResend().emails.send({
      from: fromEmail,
      to: 'matthew@othersyde.co.uk',
      subject: `New CURE Club application from ${cleanName}`,
      text: admin.text,
      html: admin.html,
    });
  } catch (err) {
    console.error('Application notification email failed', err);
  }

  return res.status(200).json({
    application_id: inserted.id,
    status: (inserted.status as string) ?? 'pending',
  });
}
