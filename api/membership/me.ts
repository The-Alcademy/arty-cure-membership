// ─────────────────────────────────────────────────────────────────
// api/membership/me.ts
//
// Public endpoint that reads a magic-link token and returns the
// member's pass data, including a server-generated QR code as a
// base64 data URL.
//
// Auth model: the token IS the auth. Anyone with the link can see
// the pass. Payload is non-sensitive (name + tier + QR encoding
// the member number).
//
// Usage:
//   GET /api/membership/me?token=<signed-token>
//
// Returns:
//   {
//     member_number, name, email,
//     arty_active, cure_active,
//     qr_data_url   // 'data:image/png;base64,...'
//   }
//
// 400 if token missing
// 401 if token invalid (tampered, wrong signature, malformed)
// 404 if token valid but member no longer exists
// 500 on Supabase or QR generation error
// ─────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import { verifyToken } from '../_lib/memberToken.js';

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const raw = req.query.token;
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token) {
    return res.status(400).json({ error: 'token_required' });
  }

  const memberNumber = verifyToken(token);
  if (!memberNumber) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  // Fetch the member
  const { data, error } = await getSupabase()
    .from('members')
    .select('member_number, name, email, arty_active, cure_active')
    .eq('member_number', memberNumber)
    .limit(1);

  if (error) {
    console.error('member fetch error:', error);
    return res.status(500).json({ error: 'lookup_failed' });
  }

  if (!data?.length) {
    return res.status(404).json({ error: 'member_not_found' });
  }

  const member = data[0];

  // Generate QR encoding the member number
  let qrDataUrl: string;
  try {
    qrDataUrl = await QRCode.toDataURL(member.member_number, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 400,
      color: {
        dark:  '#1A1614',
        light: '#FFFFFF',
      },
    });
  } catch (e: any) {
    console.error('QR generation error:', e?.message);
    return res.status(500).json({ error: 'qr_generation_failed' });
  }

  // No-cache: member data should reflect live status
  res.setHeader('Cache-Control', 'no-store');

  return res.status(200).json({
    member_number: member.member_number,
    name:          member.name,
    email:         member.email,
    arty_active:   !!member.arty_active,
    cure_active:   !!member.cure_active,
    qr_data_url:   qrDataUrl,
  });
}
