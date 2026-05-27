// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import ApplicationsPage from '../src/pages/admin/applications';

const TOKEN = 'test-admin-token-1';

const APP = {
  id: 'app-uuid-1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  created_at: '2026-05-01T10:00:00.000Z',
  status: 'pending',
  existing_member_email: 'ada@example.com',
  questionnaire: { q1: 'I love the conversation.', q2: 'I write programs.' },
};

// Routes the page's two endpoints. GET returns the list; POST returns a
// 200 decide response. Each call is recorded for assertions.
function installFetchMock() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.startsWith('/api/admin/applications/decide') || method === 'POST') {
      return Promise.resolve(
        new Response(
          JSON.stringify({ application_id: APP.id, status: 'accepted', checkout_session_url: 'https://x' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ applications: [APP] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.sessionStorage.setItem('admin_token', TOKEN);
  installFetchMock();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

function postCalls() {
  const fetchMock = window.fetch as unknown as ReturnType<typeof vi.fn>;
  return fetchMock.mock.calls.filter(([, init]: any[]) => (init?.method ?? 'GET').toUpperCase() === 'POST');
}

describe('ApplicationsPage', () => {
  it('renders the list: card with name, email, badge, and Q&A', async () => {
    render(<ApplicationsPage />);
    const card = await screen.findByTestId('application-card');
    expect(within(card).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(card).getByText('ada@example.com')).toBeInTheDocument();
    expect(within(card).getByTestId('existing-member-badge')).toBeInTheDocument();
    // Questionnaire answers render.
    expect(within(card).getByText('I love the conversation.')).toBeInTheDocument();
    expect(within(card).getByText('I write programs.')).toBeInTheDocument();
  });

  it('sends the GET list request with Bearer auth on mount', async () => {
    render(<ApplicationsPage />);
    await screen.findByTestId('application-card');
    const fetchMock = window.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/admin/applications?status=pending');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('accept modal flow → POSTs decision=accept with notes', async () => {
    const user = userEvent.setup();
    render(<ApplicationsPage />);
    const card = await screen.findByTestId('application-card');

    await user.click(within(card).getByTestId('accept-button'));
    const modal = await screen.findByTestId('decide-modal');
    expect(within(modal).getByTestId('decide-confirm')).toHaveTextContent('Send checkout link');

    await user.type(within(modal).getByTestId('decide-notes'), 'Strong fit');
    await user.click(within(modal).getByTestId('decide-confirm'));

    await waitFor(() => expect(postCalls().length).toBe(1));
    const [url, init] = postCalls()[0];
    expect(url).toBe('/api/admin/applications/decide');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({
      application_id: APP.id,
      decision: 'accept',
      notes: 'Strong fit',
    });

    // Inline confirmation appears.
    expect(await screen.findByTestId('decide-confirmation')).toHaveTextContent(/Accepted/);
  });

  it('reject modal flow → POSTs decision=reject (understated confirm label)', async () => {
    const user = userEvent.setup();
    render(<ApplicationsPage />);
    const card = await screen.findByTestId('application-card');

    await user.click(within(card).getByTestId('reject-button'));
    const modal = await screen.findByTestId('decide-modal');
    expect(within(modal).getByTestId('decide-confirm')).toHaveTextContent('Send rejection');

    await user.click(within(modal).getByTestId('decide-confirm'));

    await waitFor(() => expect(postCalls().length).toBe(1));
    const [, init] = postCalls()[0];
    expect(JSON.parse(init.body as string)).toEqual({
      application_id: APP.id,
      decision: 'reject',
    });
  });

  it('switching the filter to All re-fetches with status=all', async () => {
    const user = userEvent.setup();
    render(<ApplicationsPage />);
    await screen.findByTestId('application-card');

    await user.click(screen.getByTestId('filter-all'));

    await waitFor(() => {
      const fetchMock = window.fetch as unknown as ReturnType<typeof vi.fn>;
      const urls = fetchMock.mock.calls.map(([u]: any[]) => u as string);
      expect(urls.some((u) => u.includes('status=all'))).toBe(true);
    });
  });
});
