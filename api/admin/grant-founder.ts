// ─────────────────────────────────────────────────────────────────
// api/admin/grant-founder.ts
//
// Admin endpoint to grant CURE founder status. Two modes:
//
//   1) Promote an existing member:
//        body: { identifier: "MEM-0001" }         // by member_number
//        body: { identifier: "matt@example.com" } // by email
//
//   2) Create a brand-new founder (no Stripe trail):
//        body: { identifier: { email, name } }
//
// In both cases the row ends up with:
//   tier            = 'cure_founder'
//   cure_active     = true
//   cure_joined_at  = preserved if already set, else now()
//   founder_number  = FND-XXXX (auto-assigned by the migration-002 trigger)
//
// Auth: Authorization: Bearer <ADMIN_TOKEN>   (same pattern as token.ts)
//
// Returns 200:
//   { member_number, founder_number, name, email, tier, was_existing }
// ─────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MEM_RE   = /^MEM-\d+$/i;

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

export function __setSupabaseForTests(client: SupabaseClient | null) {
  _supabase = client;
}

function checkAdminAuth(req: VercelRequest): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || expected.length < 16) return false;
  const header = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(header);
  if (!m) return false;
  const provided = m[1].trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type MemberRow = {
  email:           string;
  name:            string;
  member_number:   string;
  founder_number:  string | null;
  tier:            string | null;
  cure_active:     boolean | null;
  cure_joined_at:  string | null;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!checkAdminAuth(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const body = (req.body || {}) as { identifier?: unknown };
  const id   = body.identifier;

  // ── Body shape detection ──────────────────────────────────────────
  // Three shapes accepted:
  //   string MEM-XXXX  → promote existing by member_number
  //   string email     → promote existing by email
  //   { email, name }  → create new founder
  let mode:    'promote-by-mem' | 'promote-by-email' | 'create-new';
  let memberNumberIn: string | null = null;
  let emailIn:        string | null = null;
  let nameIn:         string | null = null;

  if (typeof id === 'string') {
    const v = id.trim();
    if (MEM_RE.test(v)) {
      mode = 'promote-by-mem';
      memberNumberIn = v.toUpperCase();
    } else if (EMAIL_RE.test(v)) {
      mode = 'promote-by-email';
      emailIn = v.toLowerCase();
    } else {
      return res.status(400).json({
        error:   'identifier_invalid',
        message: 'identifier string must be either MEM-XXXX or an email address',
      });
    }
  } else if (id && typeof id === 'object') {
    const obj = id as { email?: unknown; name?: unknown };
    if (typeof obj.email !== 'string' || !EMAIL_RE.test(obj.email.trim())) {
      return res.status(400).json({ error: 'invalid_email' });
    }
    if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
      return res.status(400).json({ error: 'invalid_name' });
    }
    mode    = 'create-new';
    emailIn = obj.email.trim().toLowerCase();
    nameIn  = obj.name.trim();
  } else {
    return res.status(400).json({ error: 'identifier_required' });
  }

  const supabase = getSupabase();

  // ── Promote-existing path ─────────────────────────────────────────
  if (mode === 'promote-by-mem' || mode === 'promote-by-email') {
    const lookupQuery = mode === 'promote-by-mem'
      ? supabase.from('members').select('email, name, member_number, founder_number, tier, cure_active, cure_joined_at').eq('member_number', memberNumberIn!).limit(1)
      : supabase.from('members').select('email, name, member_number, founder_number, tier, cure_active, cure_joined_at').eq('email', emailIn!).limit(1);

    const { data: found, error: lookupErr } = await lookupQuery;
    if (lookupErr) {
      console.error('grant-founder lookup error:', lookupErr);
      return res.status(500).json({ error: 'lookup_failed' });
    }
    if (!found?.length) {
      return res.status(404).json({ error: 'member_not_found' });
    }
    const member = found[0] as MemberRow;

    if (member.tier === 'cure_founder') {
      return res.status(409).json({
        error:          'already_founder',
        member_number:  member.member_number,
        founder_number: member.founder_number,
      });
    }

    const patch: Record<string, unknown> = {
      tier:            'cure_founder',
      cure_active:     true,
      // founder_number deliberately omitted — the trigger fires on the
      // tier change and assigns FND-XXXX. Passing it explicitly as null
      // here would short-circuit the trigger's `IS NULL` guard.
    };
    if (!member.cure_joined_at) {
      patch.cure_joined_at = new Date().toISOString();
    }

    const { data: updated, error: updErr } = await supabase
      .from('members')
      .update(patch)
      .eq('email', member.email)
      .select('email, name, member_number, founder_number, tier')
      .single();
    if (updErr) {
      console.error('grant-founder update error:', updErr);
      return res.status(500).json({ error: 'update_failed' });
    }

    await supabase.from('membership_events').insert({
      member_email: updated!.email,
      event_type:   'granted_founder',
      source:       'admin',
      metadata:     { identifier: typeof id === 'string' ? id : null, mode },
    });

    return res.status(200).json({
      member_number:  updated!.member_number,
      founder_number: updated!.founder_number,
      name:           updated!.name,
      email:          updated!.email,
      tier:           updated!.tier,
      was_existing:   true,
    });
  }

  // ── Create-new path ───────────────────────────────────────────────
  // Idempotency check: if a member with this email already exists, refuse
  // and tell the caller to promote them by passing the string identifier
  // instead (so the audit trail stays correct).
  const { data: existing, error: existErr } = await supabase
    .from('members')
    .select('email, member_number, tier, founder_number')
    .eq('email', emailIn!)
    .limit(1);
  if (existErr) {
    console.error('grant-founder pre-check error:', existErr);
    return res.status(500).json({ error: 'lookup_failed' });
  }
  if (existing?.length) {
    const m = existing[0];
    if (m.tier === 'cure_founder') {
      return res.status(409).json({
        error:          'already_founder',
        member_number:  m.member_number,
        founder_number: m.founder_number,
      });
    }
    return res.status(409).json({
      error:         'member_exists',
      message:       'A member with that email exists. Promote them by passing identifier="<email>" instead.',
      member_number: m.member_number,
    });
  }

  const { data: created, error: insertErr } = await supabase
    .from('members')
    .insert({
      email:          emailIn!,
      name:           nameIn!,
      tier:           'cure_founder',
      cure_active:    true,
      cure_joined_at: new Date().toISOString(),
    })
    .select('email, name, member_number, founder_number, tier')
    .single();
  if (insertErr) {
    console.error('grant-founder insert error:', insertErr);
    return res.status(500).json({ error: 'insert_failed' });
  }

  await supabase.from('membership_events').insert({
    member_email: created!.email,
    event_type:   'granted_founder',
    source:       'admin',
    metadata:     { mode: 'create-new', name: nameIn },
  });

  return res.status(200).json({
    member_number:  created!.member_number,
    founder_number: created!.founder_number,
    name:           created!.name,
    email:          created!.email,
    tier:           created!.tier,
    was_existing:   false,
  });
}
