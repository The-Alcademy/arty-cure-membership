import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import handler, {
  __setStripeForTests,
  __setResendForTests,
} from '../api/stripe-webhook';

config({ path: '.env.local' });

const __dirname = dirname(fileURLToPath(import.meta.url));
const loadFixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));

const checkoutCompletedFixture = loadFixture('checkout-session-completed.json');
const subscriptionCreatedFixture = loadFixture('subscription-created.json');
const subscriptionUpdatedFixture = loadFixture('subscription-updated.json');
const subscriptionDeletedFixture = loadFixture('subscription-deleted.json');
const paymentFailedFixture = loadFixture('payment-failed.json');

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

function makeReq(body: string, signature: string | undefined = 'sig_test') {
  return {
    method: 'POST',
    headers: signature ? { 'stripe-signature': signature } : {},
    body,
  } as any;
}

const constructEvent = vi.fn();
const retrieveSubscription = vi.fn();
const retrieveCustomer = vi.fn();
const sendEmail = vi.fn();

const mockStripe: any = {
  webhooks: { constructEvent },
  subscriptions: { retrieve: retrieveSubscription },
  customers: { retrieve: retrieveCustomer },
};
const mockResend: any = { emails: { send: sendEmail } };

const TEST_EMAILS = [
  'jane.arty@example.com',
  'backup@example.com',
  'switch@example.com',
  'cancel@example.com',
  'payfail@example.com',
];

const TEST_EVENT_IDS = [
  'evt_test_checkout_arty_1',
  'evt_test_sub_created_1',
  'evt_test_sub_updated_1',
  'evt_test_sub_deleted_1',
  'evt_test_payment_failed_1',
];

async function cleanup() {
  await supabase
    .from('membership_events')
    .delete()
    .in('member_email', TEST_EMAILS);
  for (const id of TEST_EVENT_IDS) {
    await supabase
      .from('membership_events')
      .delete()
      .contains('metadata', { stripe_event_id: id });
  }
  await supabase.from('members').delete().in('email', TEST_EMAILS);
}

beforeAll(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test';
  process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? 're_test';
  process.env.RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'members@test.example';
  await cleanup();
});

beforeEach(async () => {
  constructEvent.mockReset();
  retrieveSubscription.mockReset();
  retrieveCustomer.mockReset();
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ id: 'em_test_1' });
  __setStripeForTests(mockStripe);
  __setResendForTests(mockResend);
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  __setStripeForTests(null);
  __setResendForTests(null);
});

async function callWith(fixture: any) {
  constructEvent.mockReturnValue(fixture);
  const req = makeReq(JSON.stringify(fixture));
  const res = makeRes();
  await handler(req, res as any);
  return res;
}

describe('POST /api/stripe-webhook — signature', () => {
  it('returns 400 when signature header is missing', async () => {
    const res = makeRes();
    await handler(
      { method: 'POST', headers: {}, body: '{}' } as any,
      res as any,
    );
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when signature verification fails', async () => {
    constructEvent.mockImplementation(() => {
      throw new Error('bad signature');
    });
    const req = makeReq('{}', 'sig_bad');
    const res = makeRes();
    await handler(req, res as any);
    expect(res.statusCode).toBe(400);
    expect((res.body as any).error).toBe('invalid_signature');
  });
});

describe('POST /api/stripe-webhook — checkout.session.completed', () => {
  it('upserts member, sets arty_active, writes joined_arty, sends welcome email', async () => {
    retrieveSubscription.mockResolvedValue({
      id: 'sub_test_arty_1',
      customer: 'cus_test_arty_1',
      items: {
        data: [
          {
            id: 'si_test_arty_1',
            price: {
              id: 'price_arty_live',
              metadata: { club: 'arty' },
              product: { id: 'prod_arty_live', metadata: {} },
            },
          },
        ],
      },
      metadata: {},
    });

    const res = await callWith(checkoutCompletedFixture);
    expect(res.statusCode).toBe(200);

    const { data: member } = await supabase
      .from('members')
      .select('email, name, arty_active, cure_active, arty_joined_at, stripe_customer_id, stripe_arty_subscription_id, member_number')
      .eq('email', 'jane.arty@example.com')
      .single();

    expect(member).toBeTruthy();
    expect(member!.arty_active).toBe(true);
    expect(member!.cure_active).toBe(false);
    expect(member!.arty_joined_at).toBeTruthy();
    expect(member!.stripe_customer_id).toBe('cus_test_arty_1');
    expect(member!.stripe_arty_subscription_id).toBe('sub_test_arty_1');
    expect(member!.name).toBe('Jane Arty');

    const { data: events } = await supabase
      .from('membership_events')
      .select('event_type, metadata')
      .eq('member_email', 'jane.arty@example.com');
    expect(events).toHaveLength(1);
    expect(events![0].event_type).toBe('joined_arty');
    expect((events![0].metadata as any).stripe_event_id).toBe(checkoutCompletedFixture.id);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailArgs = sendEmail.mock.calls[0][0];
    expect(emailArgs.to).toBe('jane.arty@example.com');
    expect(emailArgs.from).toBe(process.env.RESEND_FROM_EMAIL);
    expect(emailArgs.text).toContain('Jane Arty');
    expect(emailArgs.text).toContain(member!.member_number);
  });

  it('is idempotent — re-receiving the same event id is a no-op', async () => {
    retrieveSubscription.mockResolvedValue({
      id: 'sub_test_arty_1',
      customer: 'cus_test_arty_1',
      items: {
        data: [
          {
            id: 'si_test_arty_1',
            price: {
              id: 'price_arty_live',
              metadata: { club: 'arty' },
              product: { id: 'prod_arty_live', metadata: {} },
            },
          },
        ],
      },
      metadata: {},
    });

    await callWith(checkoutCompletedFixture);
    sendEmail.mockClear();
    const res2 = await callWith(checkoutCompletedFixture);
    expect(res2.statusCode).toBe(200);
    expect((res2.body as any).idempotent).toBe(true);

    const { data: events } = await supabase
      .from('membership_events')
      .select('id')
      .eq('member_email', 'jane.arty@example.com');
    expect(events).toHaveLength(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('POST /api/stripe-webhook — customer.subscription.created (backup)', () => {
  it('creates member row if no row exists yet for the customer', async () => {
    retrieveCustomer.mockResolvedValue({
      id: 'cus_test_backup_1',
      object: 'customer',
      email: 'backup@example.com',
      name: 'Backup User',
      deleted: false,
    });

    const res = await callWith(subscriptionCreatedFixture);
    expect(res.statusCode).toBe(200);

    const { data: member } = await supabase
      .from('members')
      .select('email, cure_active, arty_active, stripe_customer_id, stripe_cure_subscription_id')
      .eq('email', 'backup@example.com')
      .single();
    expect(member).toBeTruthy();
    expect(member!.cure_active).toBe(true);
    expect(member!.arty_active).toBe(false);
    expect(member!.stripe_customer_id).toBe('cus_test_backup_1');
    expect(member!.stripe_cure_subscription_id).toBe('sub_test_backup_1');
  });

  it('is a no-op if a member already exists for the customer', async () => {
    await supabase.from('members').insert({
      email: 'backup@example.com',
      name: 'Backup User',
      stripe_customer_id: 'cus_test_backup_1',
      cure_active: true,
      cure_joined_at: new Date().toISOString(),
      stripe_cure_subscription_id: 'sub_test_pre_existing',
    });

    const res = await callWith(subscriptionCreatedFixture);
    expect(res.statusCode).toBe(200);
    expect(retrieveCustomer).not.toHaveBeenCalled();

    const { data: member } = await supabase
      .from('members')
      .select('stripe_cure_subscription_id')
      .eq('email', 'backup@example.com')
      .single();
    expect(member!.stripe_cure_subscription_id).toBe('sub_test_pre_existing');
  });
});

describe('POST /api/stripe-webhook — customer.subscription.updated', () => {
  it('switches from arty-only to both, writes switched_to_both', async () => {
    await supabase.from('members').insert({
      email: 'switch@example.com',
      name: 'Switch User',
      stripe_customer_id: 'cus_test_switch_1',
      arty_active: true,
      arty_joined_at: new Date().toISOString(),
      stripe_arty_subscription_id: 'sub_test_switch_1',
    });

    const res = await callWith(subscriptionUpdatedFixture);
    expect(res.statusCode).toBe(200);

    const { data: member } = await supabase
      .from('members')
      .select('arty_active, cure_active, cure_joined_at, stripe_cure_subscription_id')
      .eq('email', 'switch@example.com')
      .single();
    expect(member!.arty_active).toBe(true);
    expect(member!.cure_active).toBe(true);
    expect(member!.cure_joined_at).toBeTruthy();
    expect(member!.stripe_cure_subscription_id).toBe('sub_test_switch_1');

    const { data: events } = await supabase
      .from('membership_events')
      .select('event_type')
      .eq('member_email', 'switch@example.com');
    expect(events).toHaveLength(1);
    expect(events![0].event_type).toBe('switched_to_both');
  });
});

describe('POST /api/stripe-webhook — customer.subscription.deleted', () => {
  it('clears matching booleans, sets cancelled_at, writes cancelled_arty', async () => {
    await supabase.from('members').insert({
      email: 'cancel@example.com',
      name: 'Cancel User',
      stripe_customer_id: 'cus_test_cancel_1',
      arty_active: true,
      arty_joined_at: new Date().toISOString(),
      stripe_arty_subscription_id: 'sub_test_cancel_1',
    });

    const res = await callWith(subscriptionDeletedFixture);
    expect(res.statusCode).toBe(200);

    const { data: member } = await supabase
      .from('members')
      .select('arty_active, arty_cancelled_at')
      .eq('email', 'cancel@example.com')
      .single();
    expect(member!.arty_active).toBe(false);
    expect(member!.arty_cancelled_at).toBeTruthy();

    const { data: events } = await supabase
      .from('membership_events')
      .select('event_type')
      .eq('member_email', 'cancel@example.com');
    expect(events).toHaveLength(1);
    expect(events![0].event_type).toBe('cancelled_arty');
  });
});

describe('POST /api/stripe-webhook — invoice.payment_failed', () => {
  it('writes payment_failed event, does not change booleans', async () => {
    await supabase.from('members').insert({
      email: 'payfail@example.com',
      name: 'PayFail User',
      stripe_customer_id: 'cus_test_payfail_1',
      arty_active: true,
      arty_joined_at: new Date().toISOString(),
      stripe_arty_subscription_id: 'sub_test_payfail_1',
    });

    const res = await callWith(paymentFailedFixture);
    expect(res.statusCode).toBe(200);

    const { data: member } = await supabase
      .from('members')
      .select('arty_active, arty_cancelled_at')
      .eq('email', 'payfail@example.com')
      .single();
    expect(member!.arty_active).toBe(true);
    expect(member!.arty_cancelled_at).toBeNull();

    const { data: events } = await supabase
      .from('membership_events')
      .select('event_type, metadata')
      .eq('member_email', 'payfail@example.com');
    expect(events).toHaveLength(1);
    expect(events![0].event_type).toBe('payment_failed');
    expect((events![0].metadata as any).invoice_id).toBe('in_test_failed_1');
  });
});
