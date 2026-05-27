import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

import handler, {
  __setResendForTests,
  __setSupabaseForTests,
} from '../api/membership/apply';

config({ path: '.env.local' });

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

async function call(body: unknown) {
  const res = makeRes();
  await handler(makeReq(body), res as any);
  return res;
}

const VALID_QUESTIONNAIRE = {
  q1: 'What draws me is the conversation.',
  q2: 'I make sound collages and worry about entropy.',
  q3: 'Whether attention is a renewable resource.',
  q4: 'Delia Derbyshire — she heard the future in tape.',
  q5: 'Looking forward to it.',
};

const sendEmail = vi.fn();
const mockResend: any = { emails: { send: sendEmail } };

// Mock client whose pre-insert lookups succeed (empty) but whose insert fails,
// to exercise the "row insert failed" 500 path without a real DB error.
function makeFailingSupabase(): any {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    ilike: () => builder,
    limit: () => Promise.resolve({ data: [], error: null }),
    insert: () => ({
      select: () => ({
        single: () =>
          Promise.resolve({ data: null, error: { message: 'simulated insert failure' } }),
      }),
    }),
  };
  return { from: () => builder };
}

async function cleanup() {
  await supabase.from('cure_applications').delete().like('email', '%@example.com');
  await supabase.from('members').delete().like('email', '%@example.com');
}

beforeAll(async () => {
  process.env.RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'members@test.example';
  process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? 're_test';
  await cleanup();
});

beforeEach(async () => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ id: 'em_test_1' });
  __setResendForTests(mockResend);
  __setSupabaseForTests(null); // use the real DB unless a test opts into a mock
  await cleanup();
});

afterEach(async () => {
  __setSupabaseForTests(null);
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

describe('POST /api/membership/apply', () => {
  it('returns 400 missing_field when the name is absent', async () => {
    const res = await call({ email: 'noname@example.com', questionnaire: VALID_QUESTIONNAIRE });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'missing_field' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_email for a malformed email', async () => {
    const res = await call({
      name: 'Bad Email',
      email: 'not-an-email',
      questionnaire: VALID_QUESTIONNAIRE,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_email' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('returns 400 questionnaire_incomplete when a required answer (q3) is missing', async () => {
    const res = await call({
      name: 'Missing Q3',
      email: 'missing-q3@example.com',
      questionnaire: { q1: 'a', q2: 'b', q4: 'd' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'questionnaire_incomplete' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('accepts a valid submission: 200, writes the row, and sends both emails', async () => {
    const res = await call({
      name: 'Fresh Applicant',
      email: 'fresh@example.com',
      questionnaire: VALID_QUESTIONNAIRE,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(typeof res.body.application_id).toBe('string');

    const { data: row } = await supabase
      .from('cure_applications')
      .select('id, name, email, questionnaire, status, existing_member_email')
      .eq('id', res.body.application_id)
      .single();
    expect(row).toBeTruthy();
    expect(row!.name).toBe('Fresh Applicant');
    expect(row!.email).toBe('fresh@example.com');
    expect(row!.status).toBe('pending');
    expect(row!.existing_member_email).toBeNull();
    expect(row!.questionnaire).toEqual(VALID_QUESTIONNAIRE);

    // Applicant confirmation + admin notification.
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const applicantArgs = sendEmail.mock.calls[0][0];
    expect(applicantArgs.to).toBe('fresh@example.com');
    expect(applicantArgs.replyTo).toBe('matthew@othersyde.co.uk');
    expect(applicantArgs.subject).toBe('Your CURE Club application — The Artyst');

    const adminArgs = sendEmail.mock.calls[1][0];
    expect(adminArgs.to).toBe('matthew@othersyde.co.uk');
    expect(adminArgs.subject).toBe('New CURE Club application from Fresh Applicant');
  });

  it('accepts a submission with no q5 (q5 is optional)', async () => {
    const res = await call({
      name: 'No Q5',
      email: 'optional@example.com',
      questionnaire: { q1: 'a', q2: 'b', q3: 'c', q4: 'd' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('pending');

    const { data: row } = await supabase
      .from('cure_applications')
      .select('questionnaire, status')
      .eq('id', res.body.application_id)
      .single();
    expect(row!.status).toBe('pending');
    expect((row!.questionnaire as Record<string, unknown>).q5).toBeUndefined();
  });

  it('flags an existing Arty member as an upgrade candidate', async () => {
    const { error: memberErr } = await supabase
      .from('members')
      .insert({ email: 'member@example.com', name: 'Existing Member', arty_active: true });
    expect(memberErr).toBeNull();

    const res = await call({
      name: 'Existing Member',
      email: 'member@example.com',
      questionnaire: VALID_QUESTIONNAIRE,
    });
    expect(res.statusCode).toBe(200);

    const { data: row } = await supabase
      .from('cure_applications')
      .select('existing_member_email')
      .eq('id', res.body.application_id)
      .single();
    expect(row!.existing_member_email).toBe('member@example.com');
  });

  it('returns 409 with the existing id when a pending application already exists', async () => {
    const { data: first, error } = await supabase
      .from('cure_applications')
      .insert({
        email: 'dupe@example.com',
        name: 'First Time',
        questionnaire: VALID_QUESTIONNAIRE,
        status: 'pending',
      })
      .select('id')
      .single();
    expect(error).toBeNull();

    const res = await call({
      name: 'Second Time',
      email: 'dupe@example.com',
      questionnaire: VALID_QUESTIONNAIRE,
    });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ application_id: first!.id, status: 'pending' });
    expect(sendEmail).not.toHaveBeenCalled();

    // No duplicate row was written.
    const { data: rows } = await supabase
      .from('cure_applications')
      .select('id')
      .eq('email', 'dupe@example.com');
    expect(rows!.length).toBe(1);
  });

  it('returns 500 application_failed when the row insert fails', async () => {
    __setSupabaseForTests(makeFailingSupabase());
    const res = await call({
      name: 'DB Error',
      email: 'dberror@example.com',
      questionnaire: VALID_QUESTIONNAIRE,
    });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'application_failed' });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
