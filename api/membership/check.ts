import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const raw = req.query.email;
  const email = Array.isArray(raw) ? raw[0] : raw;
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  const { data, error } = await getSupabase().rpc('is_active_member', { p_email: email });
  if (error) {
    return res.status(500).json({ error: 'lookup_failed' });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return res.status(200).json({
      is_member: false,
      arty: false,
      cure: false,
      member_number: null,
      name: null,
    });
  }

  return res.status(200).json({
    is_member: row.is_member,
    arty: row.arty,
    cure: row.cure,
    member_number: row.member_number,
    name: row.name,
  });
}
