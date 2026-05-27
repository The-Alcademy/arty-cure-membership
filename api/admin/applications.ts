// ─────────────────────────────────────────────────────────────────
// api/admin/applications.ts
//
// Admin review queue for CURE Club applications.
//
//   GET /api/admin/applications            → pending applications
//   GET /api/admin/applications?status=all → every application
//
// Also accepts ?status=accepted|rejected|withdrawn to filter to a single
// state. Newest first.
//
// Auth: Authorization: Bearer <ADMIN_TOKEN>  (see api/_lib/adminAuth.ts)
//
// Returns 200:
//   { applications: [ { id, name, email, created_at, status,
//                       questionnaire, existing_member_email }, ... ] }
// ─────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { checkAdminAuth } from '../_lib/adminAuth.js';

const VALID_STATUSES = ['pending', 'accepted', 'rejected', 'withdrawn'] as const;

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

export function __setSupabaseForTests(client: SupabaseClient | null) { _supabase = client; }

function firstQueryValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!checkAdminAuth(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Default to the review-worthy queue. 'all' drops the filter entirely;
  // a concrete status filters to just that state.
  const statusParam = (firstQueryValue(req.query?.status) ?? 'pending').toLowerCase();
  if (statusParam !== 'all' && !(VALID_STATUSES as readonly string[]).includes(statusParam)) {
    return res.status(400).json({ error: 'invalid_status' });
  }

  let query = getSupabase()
    .from('cure_applications')
    .select('id, name, email, created_at, status, questionnaire, existing_member_email')
    .order('created_at', { ascending: false });

  if (statusParam !== 'all') {
    query = query.eq('status', statusParam);
  }

  const { data, error } = await query;
  if (error) {
    console.error('applications list error:', error);
    return res.status(500).json({ error: 'list_failed' });
  }

  return res.status(200).json({ applications: data ?? [] });
}
