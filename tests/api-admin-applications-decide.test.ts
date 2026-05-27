import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

import handler, {
  __setStripeForTests,
  __setResendForTests,
} from '../api/admin/applications/decide';

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

function makeReq(body: unknown, opts: { auth?: string } = {}) {
  return {
    method: 'POST',
    headers: opts.auth === undefined ? {} : { authorization: opts.auth },
    body,
  } as any;
}

async function call(body: unknown, opts: { auth?: string } = { auth: `Bearer ${ADMIN_TOKEN}` }) {
  const res = makeRes();
  await handler(makeReq(body, opts), res as any);
  return res;
}

const ACCEPT_EMAIL = 'decide-accept@example.com';
const REJECT_EMAIL = 'decide-reject@example.com';
const DECIDED_EMAIL = 'decide-already@example.com';
const QUESTIONNAIRE = { q1: 'a', q2: 'b', q3: 'c', q4: 'd' };
const TEST_EMAILS = [ACCEPT_EMAIL, REJECT_EMAIL, DECIDED_EMAIL];

const createSession = vi.fn();
const sendEmail = vi.fn();
const mockStripe: any = { checkout: { sessions: { create: createSession } } };
const mockResend: any = { emails: { send: sendEmail } };

async function insertPending(email: string, status = 'pending'): Promise<string> {
  const { data, error } = await supabase
    .from('cure_applications')
    .insert({ email, name: 'Decide Tester', questionnaire: QUESTIONNAIRE, status })
    .select('id')
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function cleanup() {
  await supabase.from('cure_applications').delete().in('email', TEST_EMAILS);
}

beforeAll(async () => {
  process.env.STRIPE_PRICE_CURE = process.env.STRIPE_PRICE_CURE ?? 'price_test_cure';
  process.env.RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'members@test.example';
  process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? 're_test';
  process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? 'sk_test';
  await cleanup();
});

beforeEach(async () => {
  createSession.mockReset();
  sendEmail.mockReset();
  createSession.mockResolvedValue({ id: 'cs_test_cure_1', url: 'https://checkout.stripe.com/c/pay/cs_test_cure_1' });
  sendEmail.mockResolvedValue({ id: 'em_test_1' });
  __setStripeForTests(mockStripe);
  __setResendForTests(mockResend);
  await cleanup();
});

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  __setStripeForTests(null);
  __setResendForTests(null);
});

describe('POST /api/admin/applications/decide — auth & validation', () => {
  it('returns 401 without Bearer auth', async () => {
    const res = await call({ application_id: 'x', decision: 'accept' }, { auth: undefined });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  it('returns 405 for non-POST', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: { authorization: `Bearer ${ADMIN_TOKEN}` } } as any, res as any);
    expect(res.statusCode).toBe(405);
  });

  it('returns 400 when application_id is missing', async () => {
    const res = await call({ decision: 'accept' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'application_id_required' });
  });

  it('returns 400 for an invalid decision', async () => {
    const res = await call({ application_id: 'x', decision: 'maybe' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_decision' });
  });

  it('returns 404 for a well-formed uuid that does not exist', async () => {
    const res = await call({ application_id: '00000000-0000-0000-0000-000000000000', decision: 'accept' });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/applications/decide — accept', () => {
  it('creates a Stripe session, stores the URL, emails the link, returns 200', async () => {
    const id = await insertPending(ACCEPT_EMAIL);

    const res = await call({ application_id: id, decision: 'accept', notes: 'Strong fit' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('accepted');
    expect(res.body.checkout_session_url).toBe('https://checkout.stripe.com/c/pay/cs_test_cure_1');

    // Stripe called with the CURE price + cure_application_id metadata.
    expect(createSession).toHaveBeenCalledTimes(1);
    const sessionArgs = createSession.mock.calls[0][0];
    expect(sessionArgs.mode).toBe('subscription');
    expect(sessionArgs.customer_email).toBe(ACCEPT_EMAIL);
    expect(sessionArgs.line_items[0].price).toBe(process.env.STRIPE_PRICE_CURE);
    expect(sessionArgs.metadata.cure_application_id).toBe(id);
    expect(sessionArgs.metadata.club).toBe('cure');
    expect(typeof sessionArgs.success_url).toBe('string');
    expect(typeof sessionArgs.cancel_url).toBe('string');

    // DB row updated.
    const { data: row } = await supabase
      .from('cure_applications')
      .select('status, checkout_session_url, decided_at, decided_by, decision_notes')
      .eq('id', id)
      .single();
    expect(row!.status).toBe('accepted');
    expect(row!.checkout_session_url).toBe('https://checkout.stripe.com/c/pay/cs_test_cure_1');
    expect(row!.decided_at).toBeTruthy();
    expect(row!.decision_notes).toBe('Strong fit');

    // Applicant emailed the link.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailArgs = sendEmail.mock.calls[0][0];
    expect(emailArgs.to).toBe(ACCEPT_EMAIL);
    expect(emailArgs.from).toBe(process.env.RESEND_FROM_EMAIL);
    expect(emailArgs.replyTo).toBe('matthew@othersyde.co.uk');
    expect(emailArgs.subject).toBe('Welcome to the CURE Club — payment link inside');
    expect(emailArgs.text).toContain('https://checkout.stripe.com/c/pay/cs_test_cure_1');
    expect(emailArgs.html).toContain('https://checkout.stripe.com/c/pay/cs_test_cure_1');
  });

  it('returns 500 if Stripe fails, leaving the row pending', async () => {
    const id = await insertPending(ACCEPT_EMAIL);
    createSession.mockRejectedValueOnce(new Error('stripe down'));

    const res = await call({ application_id: id, decision: 'accept' });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'checkout_failed' });
    expect(sendEmail).not.toHaveBeenCalled();

    const { data: row } = await supabase
      .from('cure_applications')
      .select('status')
      .eq('id', id)
      .single();
    expect(row!.status).toBe('pending');
  });
});

describe('POST /api/admin/applications/decide — reject', () => {
  it('marks rejected and sends the respectful note, returns 200', async () => {
    const id = await insertPending(REJECT_EMAIL);

    const res = await call({ application_id: id, decision: 'reject', notes: 'timing' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ application_id: id, status: 'rejected' });
    expect(createSession).not.toHaveBeenCalled();

    const { data: row } = await supabase
      .from('cure_applications')
      .select('status, decided_at, decision_notes, checkout_session_url')
      .eq('id', id)
      .single();
    expect(row!.status).toBe('rejected');
    expect(row!.decided_at).toBeTruthy();
    expect(row!.decision_notes).toBe('timing');
    expect(row!.checkout_session_url).toBeNull();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailArgs = sendEmail.mock.calls[0][0];
    expect(emailArgs.to).toBe(REJECT_EMAIL);
    expect(emailArgs.subject).toBe('About your CURE Club application');
    expect(emailArgs.replyTo).toBe('matthew@othersyde.co.uk');
  });
});

describe('POST /api/admin/applications/decide — already decided', () => {
  it('returns 409 when the application is not pending', async () => {
    const id = await insertPending(DECIDED_EMAIL, 'accepted');

    const res = await call({ application_id: id, decision: 'reject' });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('already_decided');
    expect(res.body.status).toBe('accepted');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });
});
