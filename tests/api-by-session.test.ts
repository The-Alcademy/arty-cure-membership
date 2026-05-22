import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

import handler, { __setStripeForTests } from '../api/membership/by-session';

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
  return {
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
}

function makeReq(query: Record<string, string | undefined>) {
  return { method: 'GET', query } as any;
}

const retrieveSession = vi.fn();
const mockStripe: any = {
  checkout: { sessions: { retrieve: retrieveSession } },
};

const TEST_EMAILS = ['ready-member@example.com', 'pending-member@example.com'];

async function cleanup() {
  await supabase.from('members').delete().in('email', TEST_EMAILS);
}

beforeAll(async () => {
  await cleanup();
  __setStripeForTests(mockStripe);
});

beforeEach(async () => {
  retrieveSession.mockReset();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  __setStripeForTests(null);
});

async function call(query: Record<string, string | undefined>) {
  const req = makeReq(query);
  const res = makeRes();
  await handler(req, res as any);
  return res;
}

describe('GET /api/membership/by-session', () => {
  it('returns 400 for a missing/invalid session_id', async () => {
    const res = await call({});
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_session_id' });
    expect(retrieveSession).not.toHaveBeenCalled();
  });

  it('returns 400 when Stripe rejects the session_id', async () => {
    retrieveSession.mockRejectedValue(new Error('No such checkout session'));
    const res = await call({ session_id: 'cs_test_does_not_exist' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_session_id' });
  });

  it('returns ready:false when the webhook has not yet upserted the member', async () => {
    retrieveSession.mockResolvedValue({
      id: 'cs_test_pending_1',
      customer_email: 'pending-member@example.com',
    });
    const res = await call({ session_id: 'cs_test_pending_1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ready: false });
  });

  it('returns ready:true with member details once the member is active', async () => {
    const { data: inserted, error } = await supabase
      .from('members')
      .insert({
        email: 'ready-member@example.com',
        name: 'Ready Member',
        arty_active: true,
        cure_active: true,
      })
      .select('member_number')
      .single();
    expect(error).toBeNull();

    retrieveSession.mockResolvedValue({
      id: 'cs_test_ready_1',
      customer_email: 'ready-member@example.com',
    });

    const res = await call({ session_id: 'cs_test_ready_1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ready: true,
      name: 'Ready Member',
      member_number: inserted!.member_number,
      arty: true,
      cure: true,
    });
  });
});
