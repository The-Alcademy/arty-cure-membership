import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

import handler, { __setStripeForTests } from '../api/membership/cancel';
import { signToken } from '../api/_lib/memberToken.js';

config({ path: '.env.local' });

// MEMBER_TOKEN_SECRET isn't in the repo's .env.example.value; provide a
// deterministic test value if it isn't set so signToken/verifyToken work.
// (signToken/verifyToken read getSecret() lazily at call time, so setting
// this before the first call is sufficient.)
if (!process.env.MEMBER_TOKEN_SECRET || process.env.MEMBER_TOKEN_SECRET.length < 32) {
  process.env.MEMBER_TOKEN_SECRET = 'test-secret-test-secret-test-secret-test-secret';
}

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

function makeReq(body: unknown) {
  return { method: 'POST', headers: {}, body } as any;
}

async function call(body: unknown) {
  const req = makeReq(body);
  const res = makeRes();
  await handler(req, res as any);
  return res;
}

const subscriptionsUpdate = vi.fn();
const mockStripe: any = {
  subscriptions: { update: subscriptionsUpdate },
};

// We need a stable member_number so we can sign a token before insertion.
// The schema auto-assigns member_number via a trigger; we insert, read the
// auto-generated number back, and use that to sign tokens for the test.
const TEST_EMAILS = ['cancel-test@example.com'];

async function cleanup() {
  await supabase.from('members').delete().in('email', TEST_EMAILS);
}

beforeAll(async () => {
  await cleanup();
  __setStripeForTests(mockStripe);
});

beforeEach(async () => {
  subscriptionsUpdate.mockReset();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  __setStripeForTests(null);
});

describe('POST /api/membership/cancel', () => {
  it('returns 400 when token is missing', async () => {
    const res = await call({});
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'token_required' });
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('returns 401 when token is malformed / signature wrong', async () => {
    const res = await call({ token: 'not-a-real-token' });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'invalid_token' });
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 when the token is valid but the member is gone', async () => {
    const token = signToken('MEM-DOES-NOT-EXIST');
    const res = await call({ token });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'member_not_found' });
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('cancels each active subscription at period end and stamps members.cancelled_at', async () => {
    // Insert a member with both subscriptions active.
    const { data: inserted, error: insertErr } = await supabase
      .from('members')
      .insert({
        email:                       'cancel-test@example.com',
        name:                        'Cancel Test',
        arty_active:                 true,
        cure_active:                 true,
        stripe_customer_id:          'cus_cancel_test',
        stripe_arty_subscription_id: 'sub_arty_test',
        stripe_cure_subscription_id: 'sub_cure_test',
      })
      .select('member_number')
      .single();
    expect(insertErr).toBeNull();
    const memberNumber = (inserted as { member_number: string }).member_number;

    const periodEndUnix = Math.floor(new Date('2027-01-15T00:00:00Z').getTime() / 1000);
    subscriptionsUpdate.mockResolvedValue({
      id:                   'sub_after_update',
      cancel_at_period_end: true,
      current_period_end:   periodEndUnix,
    });

    const token = signToken(memberNumber);
    const res = await call({ token });

    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.cancelled_arty).toBe(true);
    expect(body.cancelled_cure).toBe(true);
    expect(typeof body.period_end).toBe('string');
    expect((body.period_end as string).startsWith('2027-01-15')).toBe(true);

    // Stripe should have been called once per active sub, with cancel_at_period_end=true.
    expect(subscriptionsUpdate).toHaveBeenCalledTimes(2);
    const calledIds = subscriptionsUpdate.mock.calls.map((c) => c[0]).sort();
    expect(calledIds).toEqual(['sub_arty_test', 'sub_cure_test']);
    for (const call of subscriptionsUpdate.mock.calls) {
      expect(call[1]).toEqual({ cancel_at_period_end: true });
    }

    // Members row should have arty_cancelled_at + cure_cancelled_at stamped.
    const { data: after } = await supabase
      .from('members')
      .select('arty_active, cure_active, arty_cancelled_at, cure_cancelled_at')
      .eq('member_number', memberNumber)
      .single();
    // *_active stays true — webhook flips it at period end, not us.
    expect(after?.arty_active).toBe(true);
    expect(after?.cure_active).toBe(true);
    expect(typeof after?.arty_cancelled_at).toBe('string');
    expect(typeof after?.cure_cancelled_at).toBe('string');
    expect(after!.arty_cancelled_at!.startsWith('2027-01-15')).toBe(true);
    expect(after!.cure_cancelled_at!.startsWith('2027-01-15')).toBe(true);
  });

  it('returns 409 when there is nothing to cancel (no active subscriptions)', async () => {
    const { data: inserted } = await supabase
      .from('members')
      .insert({
        email:       'cancel-test@example.com',
        name:        'Cancel Test',
        arty_active: false,
        cure_active: false,
      })
      .select('member_number')
      .single();
    const memberNumber = (inserted as { member_number: string }).member_number;
    const token = signToken(memberNumber);
    const res = await call({ token });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'nothing_to_cancel' });
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
  });
});
