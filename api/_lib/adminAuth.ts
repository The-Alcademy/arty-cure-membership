// ─────────────────────────────────────────────────────────────────
// api/_lib/adminAuth.ts
//
// Shared Bearer-token guard for the /api/admin/* endpoints. Mirrors the
// inline check that shipped with api/admin/grant-founder.ts so the whole
// admin surface authenticates identically.
//
// Lives in api/_lib/ on purpose: api/ functions are bundled by Vercel
// without src/, so admin helpers must never reach across that boundary.
// ─────────────────────────────────────────────────────────────────

import type { VercelRequest } from '@vercel/node';
import { timingSafeEqual } from 'node:crypto';

// Returns true only when the request carries `Authorization: Bearer <ADMIN_TOKEN>`
// and the token matches in constant time. A missing or too-short ADMIN_TOKEN
// env var fails closed.
export function checkAdminAuth(req: VercelRequest): boolean {
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
