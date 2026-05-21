import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import handler from '../api/membership/check';

config({ path: '.env.local' });

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
  const res: MockRes = {
    statusCode: 0,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return res;
}

function makeReq(query: Record<string, string | undefined>) {
  return { method: 'GET', query } as any;
}

async function call(query: Record<string, string | undefined>) {
  const req = makeReq(query);
  const res = makeRes();
  await handler(req, res as any);
  return res;
}

async function cleanup() {
  await supabase.from('members').delete().like('email', '%@example.com');
}

beforeAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
});

afterEach(async () => {
  await cleanup();
});

describe('GET /api/membership/check', () => {
  it('returns 400 when email is missing', async () => {
    const res = await call({});
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_email' });
  });

  it('returns is_member:false with null fields for a non-existent email', async () => {
    const res = await call({ email: 'nobody@example.com' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      is_member: false,
      arty: false,
      cure: false,
      member_number: null,
      name: null,
    });
  });

  it('returns is_member:true arty:true cure:false for an active Arty-only member', async () => {
    const { data, error } = await supabase
      .from('members')
      .insert({ email: 'arty-only@example.com', name: 'Arty Only', arty_active: true })
      .select('member_number')
      .single();
    expect(error).toBeNull();
    const memberNumber = data!.member_number;

    const res = await call({ email: 'arty-only@example.com' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      is_member: true,
      arty: true,
      cure: false,
      member_number: memberNumber,
      name: 'Arty Only',
    });
  });

  it('looks up case-insensitively', async () => {
    const { data, error } = await supabase
      .from('members')
      .insert({ email: 'mixedcase@example.com', name: 'Mixed Case', cure_active: true })
      .select('member_number')
      .single();
    expect(error).toBeNull();
    const memberNumber = data!.member_number;

    const res = await call({ email: 'MIXEDCASE@EXAMPLE.COM' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      is_member: true,
      arty: false,
      cure: true,
      member_number: memberNumber,
      name: 'Mixed Case',
    });
  });
});
