import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

import handler from '../api/admin/grant-founder';

config({ path: '.env.local' });

// Make sure ADMIN_TOKEN is present (>= 16 chars) so checkAdminAuth has
// something deterministic to compare against. If the environment doesn't
// supply one, set a deterministic test value.
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
  body: unknown;
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

function makeReq(body: unknown, opts: { auth?: string } = {}) {
  return {
    method:  'POST',
    headers: opts.auth === undefined ? {} : { authorization: opts.auth },
    body,
  } as any;
}

async function call(body: unknown, opts: { auth?: string } = { auth: `Bearer ${ADMIN_TOKEN}` }) {
  const res = makeRes();
  await handler(makeReq(body, opts), res as any);
  return res;
}

const TEST_EMAILS = [
  'grant-existing@example.com',
  'grant-new@example.com',
  'grant-already-founder@example.com',
];

async function cleanup() {
  // membership_events rows referencing these members
  await supabase.from('membership_events').delete().in('member_email', TEST_EMAILS);
  await supabase.from('members').delete().in('email', TEST_EMAILS);
}

beforeAll(async () => { await cleanup(); });
beforeEach(async () => { await cleanup(); });
afterAll(async () => { await cleanup(); });

describe('POST /api/admin/grant-founder', () => {
  it('returns 401 without Bearer auth', async () => {
    const res = await call({ identifier: 'MEM-0001' }, { auth: undefined });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  it('returns 401 with wrong bearer token', async () => {
    const res = await call({ identifier: 'MEM-0001' }, { auth: 'Bearer wrong-token-xxxxxxxxx' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when body is missing identifier', async () => {
    const res = await call({});
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'identifier_required' });
  });

  it('returns 400 when identifier string is neither MEM-XXXX nor email', async () => {
    const res = await call({ identifier: 'not-a-thing' });
    expect(res.statusCode).toBe(400);
    expect((res.body as any).error).toBe('identifier_invalid');
  });

  it('returns 404 when identifier looks valid but matches no existing member', async () => {
    const res = await call({ identifier: 'MEM-9999998' });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'member_not_found' });
  });

  it('promotes an existing member: sets tier=cure_founder, assigns FND-XXXX', async () => {
    const { error: insertErr } = await supabase.from('members').insert({
      email:       'grant-existing@example.com',
      name:        'Grant Existing',
      arty_active: true,
    });
    expect(insertErr).toBeNull();

    const res = await call({ identifier: 'grant-existing@example.com' });
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.tier).toBe('cure_founder');
    expect(body.was_existing).toBe(true);
    expect(typeof body.member_number).toBe('string');
    expect(/^FND-\d{4,}$/.test(String(body.founder_number ?? ''))).toBe(true);

    // Verify the DB row reflects the promotion.
    const { data: after } = await supabase
      .from('members')
      .select('tier, founder_number, cure_active, cure_joined_at')
      .eq('email', 'grant-existing@example.com')
      .single();
    expect(after?.tier).toBe('cure_founder');
    expect(after?.cure_active).toBe(true);
    expect(typeof after?.founder_number).toBe('string');
    expect(typeof after?.cure_joined_at).toBe('string');

    // membership_events entry written
    const { data: ev } = await supabase
      .from('membership_events')
      .select('event_type, source')
      .eq('member_email', 'grant-existing@example.com');
    expect((ev ?? []).some((r) => r.event_type === 'granted_founder' && r.source === 'admin')).toBe(true);
  });

  it("creates a brand-new founder via {email,name} identifier", async () => {
    const res = await call({ identifier: { email: 'grant-new@example.com', name: 'Grant New' } });
    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.tier).toBe('cure_founder');
    expect(body.was_existing).toBe(false);
    expect(body.email).toBe('grant-new@example.com');
    expect(body.name).toBe('Grant New');
    expect(typeof body.member_number).toBe('string');
    expect(/^FND-\d{4,}$/.test(String(body.founder_number ?? ''))).toBe(true);
  });

  it('returns 409 if the member is already a founder', async () => {
    const { error: insertErr } = await supabase.from('members').insert({
      email:       'grant-already-founder@example.com',
      name:        'Already Founder',
      cure_active: true,
      tier:        'cure_founder',
    });
    expect(insertErr).toBeNull();

    const res = await call({ identifier: 'grant-already-founder@example.com' });
    expect(res.statusCode).toBe(409);
    expect((res.body as any).error).toBe('already_founder');
    expect(/^FND-\d{4,}$/.test(String((res.body as any).founder_number ?? ''))).toBe(true);
  });
});
