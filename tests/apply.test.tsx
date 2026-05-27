// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import ApplyPage from '../src/pages/apply';
import questions from '../src/content/apply-questions.json';

type Question = { id: string; label: string; required: boolean; max_chars: number };
const QUESTIONS = questions as Question[];
const accessibleName = (q: Question) => (q.required ? q.label : `${q.label} (optional)`);

beforeEach(() => {
  cleanup();
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ application_id: 'app_test_1', status: 'pending' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), 'Jane Applicant');
  await user.type(screen.getByLabelText('Email'), 'jane@example.com');
  for (const q of QUESTIONS.filter((x) => x.required)) {
    await user.type(screen.getByLabelText(accessibleName(q)), `Answer ${q.id}`);
  }
}

describe('ApplyPage', () => {
  it('renders all five questions from apply-questions.json', () => {
    render(<ApplyPage />);
    expect(QUESTIONS).toHaveLength(5);
    for (const q of QUESTIONS) {
      expect(screen.getByLabelText(accessibleName(q))).toBeInTheDocument();
      expect(screen.getByTestId(`counter-${q.id}`)).toBeInTheDocument();
    }
  });

  it('keeps submit disabled until name, email, and the four required answers are filled', async () => {
    const user = userEvent.setup();
    render(<ApplyPage />);

    const submit = screen.getByTestId('apply-submit');
    expect(submit).toBeDisabled();

    await fillRequired(user);
    expect(screen.getByTestId('apply-submit')).toBeEnabled();
  });

  it('updates the character counter as the applicant types', async () => {
    const user = userEvent.setup();
    render(<ApplyPage />);

    expect(screen.getByTestId('counter-q1')).toHaveTextContent('0 / 1500');
    await user.type(screen.getByLabelText(QUESTIONS[0].label), 'hello');
    expect(screen.getByTestId('counter-q1')).toHaveTextContent('5 / 1500');
  });

  it('POSTs the expected body shape to /api/membership/apply', async () => {
    const user = userEvent.setup();
    render(<ApplyPage />);

    await user.type(screen.getByLabelText('Name'), 'Jane Applicant');
    await user.type(screen.getByLabelText('Email'), 'jane@example.com');
    for (const q of QUESTIONS) {
      await user.type(screen.getByLabelText(accessibleName(q)), `Answer ${q.id}`);
    }

    await user.click(screen.getByTestId('apply-submit'));

    const fetchMock = window.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/membership/apply');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      name: 'Jane Applicant',
      email: 'jane@example.com',
      questionnaire: {
        q1: 'Answer q1',
        q2: 'Answer q2',
        q3: 'Answer q3',
        q4: 'Answer q4',
        q5: 'Answer q5',
      },
    });
  });

  it('renders the success state after a 200 response', async () => {
    const user = userEvent.setup();
    render(<ApplyPage />);

    await fillRequired(user);
    await user.click(screen.getByTestId('apply-submit'));

    const success = await screen.findByTestId('apply-success');
    expect(success).toHaveTextContent(
      'A confirmation is on its way to jane@example.com',
    );
    expect(success).toHaveTextContent('Matthew will be in touch within a week');
  });
});
