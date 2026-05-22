import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler, { __setStripeForTests } from '../api/checkout/create';

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

function makeReq(body: unknown) {
  return { method: 'POST', body } as any;
}

const ENV_BACKUP: Record<string, string | undefined> = {};

function snapshotEnv() {
  for (const key of [
    'STRIPE_SECRET_KEY',
    'STRIPE_PRICE_ARTY',
    'STRIPE_PRICE_CURE',
    'STRIPE_PRICE_BOTH',
    'SITE_URL',
  ]) {
    ENV_BACKUP[key] = process.env[key];
  }
}

function restoreEnv() {
  for (const key of Object.keys(ENV_BACKUP)) {
    if (ENV_BACKUP[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ENV_BACKUP[key];
    }
  }
}

const createSession = vi.fn();
const mockStripe: any = {
  checkout: { sessions: { create: createSession } },
};

beforeEach(() => {
  snapshotEnv();
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.STRIPE_PRICE_ARTY = 'price_arty_test';
  process.env.STRIPE_PRICE_CURE = 'price_cure_test';
  process.env.STRIPE_PRICE_BOTH = 'price_both_test';
  process.env.SITE_URL = 'https://example.test';

  createSession.mockReset();
  createSession.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_test_123' });
  __setStripeForTests(mockStripe);
});

afterEach(() => {
  __setStripeForTests(null);
  restoreEnv();
});

describe('POST /api/checkout/create', () => {
  const baseBody = {
    name: 'Jane Doe',
    email: 'jane@example.com',
    signup_message: 'Hi there',
    marketing_consent: true,
  };

  it('creates an Arty session with the Arty price id and metadata', async () => {
    const res = makeRes();
    await handler(makeReq({ ...baseBody, product: 'arty' }), res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_123' });
    expect(createSession).toHaveBeenCalledTimes(1);

    const args = createSession.mock.calls[0][0];
    expect(args.mode).toBe('subscription');
    expect(args.customer_email).toBe('jane@example.com');
    expect(args.line_items).toEqual([{ price: 'price_arty_test', quantity: 1 }]);
    expect(args.success_url).toBe('https://example.test/welcome?session_id={CHECKOUT_SESSION_ID}');
    expect(args.cancel_url).toBe('https://example.test/');
    expect(args.metadata).toMatchObject({
      name: 'Jane Doe',
      email: 'jane@example.com',
      club: 'arty',
    });
    expect(args.subscription_data.metadata).toEqual({
      club: 'arty',
      name: 'Jane Doe',
      email: 'jane@example.com',
    });
  });

  it('creates a CURE session with the CURE price id and metadata', async () => {
    const res = makeRes();
    await handler(makeReq({ ...baseBody, product: 'cure' }), res as any);

    expect(res.statusCode).toBe(200);
    const args = createSession.mock.calls[0][0];
    expect(args.line_items).toEqual([{ price: 'price_cure_test', quantity: 1 }]);
    expect(args.metadata.club).toBe('cure');
    expect(args.subscription_data.metadata).toEqual({
      club: 'cure',
      name: 'Jane Doe',
      email: 'jane@example.com',
    });
  });

  it('creates a Both session with the Both price id and metadata', async () => {
    const res = makeRes();
    await handler(makeReq({ ...baseBody, product: 'both' }), res as any);

    expect(res.statusCode).toBe(200);
    const args = createSession.mock.calls[0][0];
    expect(args.line_items).toEqual([{ price: 'price_both_test', quantity: 1 }]);
    expect(args.metadata.club).toBe('both');
    expect(args.subscription_data.metadata).toEqual({
      club: 'both',
      name: 'Jane Doe',
      email: 'jane@example.com',
    });
  });

  it('returns 400 when email is missing', async () => {
    const res = makeRes();
    await handler(
      makeReq({ product: 'arty', name: 'Jane Doe', marketing_consent: false }),
      res as any,
    );
    expect(res.statusCode).toBe(400);
    expect((res.body as any).error).toBe('missing_field');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('returns 400 when product is missing', async () => {
    const res = makeRes();
    await handler(
      makeReq({ name: 'Jane Doe', email: 'jane@example.com', marketing_consent: false }),
      res as any,
    );
    expect(res.statusCode).toBe(400);
    expect((res.body as any).error).toBe('missing_field');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('returns 400 when product is invalid', async () => {
    const res = makeRes();
    await handler(
      makeReq({ ...baseBody, product: 'platinum' }),
      res as any,
    );
    expect(res.statusCode).toBe(400);
    expect((res.body as any).error).toBe('invalid_product');
    expect(createSession).not.toHaveBeenCalled();
  });
});
