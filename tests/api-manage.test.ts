import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

import handler, { __setStripeForTests } from '../api/membership/manage';

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

function makeReq(body: unknown) {
  return { method: 'POST', headers: {}, body } as any;
}

async function call(body: unknown) {
  const req = makeReq(body);
  const res = makeRes();
  await handler(req, res as any);
  return res;
}

const createPortalSession = vi.fn();
const mockStripe: any = {
  billingPortal: { sessions: { create: createPortalSession } },
};

const TEST_EMAILS = ['manage-member@example.com', 'no-stripe@example.com'];

async function cleanup() {
  await supabase.from('members').delete().in('email', TEST_EMAILS);
}

beforeAll(async () => {
  await cleanup();
  __setStripeForTests(mockStripe);
});

beforeEach(async () => {
  createPortalSession.mockReset();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  __setStripeForTests(null);
});

describe('POST /api/membership/manage', () => {
  it('returns 400 with invalid_email when email is missing', async () => {
    const res = await call({});
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_email' });
    expect(createPortalSession).not.toHaveBeenCalled();
  });

  it('returns 400 with invalid_email when the email is malformed', async () => {
    const res = await call({ email: 'not-an-email' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_email' });
    expect(createPortalSession).not.toHaveBeenCalled();
  });

  it('returns 404 with member_not_found when no member matches the email', async () => {
    const res = await call({ email: 'nobody@example.com' });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'member_not_found' });
    expect(createPortalSession).not.toHaveBeenCalled();
  });

  it('returns 404 when the member exists but has no stripe_customer_id', async () => {
    await supabase.from('members').insert({
      email: 'no-stripe@example.com',
      name: 'No Stripe',
      arty_active: true,
    });
    const res = await call({ email: 'no-stripe@example.com' });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'member_not_found' });
    expect(createPortalSession).not.toHaveBeenCalled();
  });

  it('returns 200 with { url } for a known member, calling Stripe with the right args', async () => {
    await supabase.from('members').insert({
      email: 'manage-member@example.com',
      name: 'Manage Member',
      arty_active: true,
      stripe_customer_id: 'cus_test_manage_1',
    });

    createPortalSession.mockResolvedValue({
      id: 'bps_test_1',
      url: 'https://billing.stripe.com/p/session/test_redirect',
    });

    const res = await call({ email: 'manage-member@example.com' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      url: 'https://billing.stripe.com/p/session/test_redirect',
    });

    expect(createPortalSession).toHaveBeenCalledTimes(1);
    const args = createPortalSession.mock.calls[0][0];
    expect(args.customer).toBe('cus_test_manage_1');
    expect(typeof args.return_url).toBe('string');
    expect(args.return_url.endsWith('/manage')).toBe(true);
  });
});
