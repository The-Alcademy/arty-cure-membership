// ─────────────────────────────────────────────────────────────────
// api/membership/token.ts
//
// Admin endpoint to mint a magic link for any member.
//
// Auth: Authorization: Bearer <ADMIN_TOKEN>
//   ADMIN_TOKEN is an env var — set to a long random string in Vercel.
//
// Usage:
//   POST /api/membership/token
//     headers: { Authorization: 'Bearer <ADMIN_TOKEN>' }
//     body:    { identifier: 'MEM-0001' }  OR  { identifier: 'matthew@othersyde.co.uk' }
//
// Returns:
//   { member_id, member_number, name, email, magic_link }
//
// 401 if admin auth missing/wrong
// 404 if member not found
//
// This is intentionally minimal — when proper admin auth is built (likely
// as part of the CURE restructure work), this endpoint adopts that pattern.
// ─────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { signToken } from '../../src/lib/memberToken';

let _client: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _client;
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!checkAdminAuth(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const body = (req.body || {}) as { identifier?: string };
  const identifier = (body.identifier || '').trim();
  if (!identifier) {
    return res.status(400).json({ error: 'identifier_required' });
  }

  const supabase = getSupabase();

  // Identifier might be a MEM-XXXX or an email — try both
  const isMemNumber = /^MEM-\d+$/i.test(identifier);
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);

  if (!isMemNumber && !isEmail) {
    return res.status(400).json({
      error: 'identifier_invalid',
      message: 'identifier must be either MEM-XXXX or an email address',
    });
  }

  const query = supabase
    .from('members')
    .select('id, member_number, name, email')
    .limit(1);

  const { data, error } = isMemNumber
    ? await query.eq('member_number', identifier.toUpperCase())
    : await query.eq('email', identifier.toLowerCase());

  if (error) {
    console.error('member lookup error:', error);
    return res.status(500).json({ error: 'lookup_failed' });
  }

  if (!data?.length) {
    return res.status(404).json({ error: 'member_not_found' });
  }

  const member = data[0];

  let token: string;
  try {
    token = signToken(member.id);
  } catch (e: any) {
    console.error('signToken error:', e?.message);
    return res.status(500).json({ error: 'signing_failed' });
  }

  const site = (process.env.SITE_URL || 'https://member.theartyst.co.uk').replace(/\/$/, '');
  const magicLink = `${site}/me?token=${encodeURIComponent(token)}`;

  return res.status(200).json({
    member_id:     member.id,
    member_number: member.member_number,
    name:          member.name,
    email:         member.email,
    magic_link:    magicLink,
  });
}
