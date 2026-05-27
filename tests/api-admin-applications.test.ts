import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

import handler from '../api/admin/applications';

config({ path: '.env.local' });

if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.length < 16) {
  process.env.ADMIN_TOKEN = 'test-admin-token-test-admin-token';
}
const ADMIN_TOKEN = process.env.ADMIN_TOKEN!;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

type MockRes = {
  statusCode: number;
  body: any;
  status: (code: number) => MockRes;
  json: (body: unknown) => MockRes;
};

function makeRes(): MockRes {
  return {
    statusCode: 0,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body)   { this.body = body;       return this; },
  };
}

function makeReq(opts: { method?: string; auth?: string; query?: Record<string, string> } = {}) {
  return {
    method: opts.method ?? 'GET',
    headers: opts.auth === undefined ? {} : { authorization: opts.auth },
    query: opts.query ?? {},
  } as any;
}

async function call(opts: { method?: string; auth?: string; query?: Record<string, string> } = {}) {
  const res = makeRes();
  await handler(makeReq({ auth: `Bearer ${ADMIN_TOKEN}`, ...opts }), res as any);
  return res;
}

const PENDING_EMAIL = 'applist-pending@example.com';
const REJECTED_EMAIL = 'applist-rejected@example.com';
const QUESTIONNAIRE = { q1: 'a', q2: 'b', q3: 'c', q4: 'd' };

async function cleanup() {
  await supabase.from('cure_applications').delete().in('email', [PENDING_EMAIL, REJECTED_EMAIL]);
}

let pendingId = '';
let rejectedId = '';

beforeAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
  const { data: p } = await supabase
    .from('cure_applications')
    .insert({ email: PENDING_EMAIL, name: 'List Pending', questionnaire: QUESTIONNAIRE, status: 'pending' })
    .select('id')
    .single();
  pendingId = p!.id;
  const { data: r } = await supabase
    .from('cure_applications')
    .insert({ email: REJECTED_EMAIL, name: 'List Rejected', questionnaire: QUESTIONNAIRE, status: 'rejected' })
    .select('id')
    .single();
  rejectedId = r!.id;
});

afterAll(async () => { await cleanup(); });

describe('GET /api/admin/applications', () => {
  it('returns 401 without Bearer auth', async () => {
    const res = await call({ auth: undefined });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  it('returns 401 with a wrong bearer token', async () => {
    const res = await call({ auth: 'Bearer wrong-token-xxxxxxxxx' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 405 for non-GET methods', async () => {
    const res = await call({ method: 'POST' });
    expect(res.statusCode).toBe(405);
  });

  it('returns an array of applications under { applications }', async () => {
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.applications)).toBe(true);
  });

  it('defaults to pending only — excludes non-pending applications', async () => {
    const res = await call();
    expect(res.statusCode).toBe(200);
    const ids = res.body.applications.map((a: any) => a.id);
    expect(ids).toContain(pendingId);
    expect(ids).not.toContain(rejectedId);
    // Every returned row is pending.
    expect(res.body.applications.every((a: any) => a.status === 'pending')).toBe(true);
  });

  it('?status=all includes both pending and rejected', async () => {
    const res = await call({ query: { status: 'all' } });
    expect(res.statusCode).toBe(200);
    const ids = res.body.applications.map((a: any) => a.id);
    expect(ids).toContain(pendingId);
    expect(ids).toContain(rejectedId);
  });

  it('?status=rejected filters to just rejected', async () => {
    const res = await call({ query: { status: 'rejected' } });
    expect(res.statusCode).toBe(200);
    const ids = res.body.applications.map((a: any) => a.id);
    expect(ids).toContain(rejectedId);
    expect(ids).not.toContain(pendingId);
  });

  it('rejects an unknown status with 400', async () => {
    const res = await call({ query: { status: 'bogus' } });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_status' });
  });

  it('returns the expected shape per row', async () => {
    const res = await call();
    const row = res.body.applications.find((a: any) => a.id === pendingId);
    expect(row).toBeTruthy();
    expect(row.name).toBe('List Pending');
    expect(row.email).toBe(PENDING_EMAIL);
    expect(row.status).toBe('pending');
    expect(typeof row.created_at).toBe('string');
    expect(row.questionnaire).toEqual(QUESTIONNAIRE);
    expect('existing_member_email' in row).toBe(true);
  });

  it('returns results newest-first', async () => {
    // Insert a third, newer pending row and confirm ordering.
    const { data: newer } = await supabase
      .from('cure_applications')
      .insert({ email: PENDING_EMAIL, name: 'Newer Pending', questionnaire: QUESTIONNAIRE, status: 'pending' })
      .select('id, created_at')
      .single();
    const res = await call();
    const rows = res.body.applications as Array<{ created_at: string }>;
    const times = rows.map((r) => new Date(r.created_at).getTime());
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
    expect(newer).toBeTruthy();
  });
});
