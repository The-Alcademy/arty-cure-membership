// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import GrantFounderPage from '../src/pages/admin/grant-founder';

const TOKEN = 'test-admin-token-1';

beforeEach(() => {
  cleanup();
  window.sessionStorage.clear();
  // Skip the window.prompt path by seeding the token in sessionStorage.
  window.sessionStorage.setItem('admin_token', TOKEN);

  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({
      member_number:  'MEM-0042',
      founder_number: 'FND-0003',
      name:           'Test Founder',
      email:          'test@example.com',
      tier:           'cure_founder',
      was_existing:   true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe('GrantFounderPage', () => {
  it('renders both mode cards and the promote-form by default', () => {
    render(<GrantFounderPage />);
    expect(screen.getByTestId('mode-promote')).toBeInTheDocument();
    expect(screen.getByTestId('mode-create')).toBeInTheDocument();
    expect(screen.getByTestId('identifier-input')).toBeInTheDocument();
    expect(screen.queryByTestId('new-name-input')).toBeNull();
    expect(screen.queryByTestId('new-email-input')).toBeNull();
  });

  it('switches to create-mode fields when the second card is selected', async () => {
    const user = userEvent.setup();
    render(<GrantFounderPage />);
    await user.click(within(screen.getByTestId('mode-create')).getByRole('radio'));
    expect(screen.getByTestId('new-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('new-email-input')).toBeInTheDocument();
    expect(screen.queryByTestId('identifier-input')).toBeNull();
  });

  it('POSTs the identifier string (promote mode) with Bearer auth', async () => {
    const user = userEvent.setup();
    render(<GrantFounderPage />);
    await user.type(screen.getByTestId('identifier-input'), 'MEM-0001');
    await user.click(screen.getByTestId('grant-submit'));

    const fetchMock = window.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/grant-founder');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({ identifier: 'MEM-0001' });

    // Success state visible
    const result = await screen.findByTestId('grant-result');
    expect(within(result).getByTestId('grant-mem')).toHaveTextContent('MEM-0042');
    expect(within(result).getByTestId('grant-fnd')).toHaveTextContent('FND-0003');
  });

  it('POSTs an {email,name} object in create mode', async () => {
    const user = userEvent.setup();
    render(<GrantFounderPage />);
    await user.click(within(screen.getByTestId('mode-create')).getByRole('radio'));
    await user.type(screen.getByTestId('new-name-input'), 'Jane Doe');
    await user.type(screen.getByTestId('new-email-input'), 'jane@example.com');
    await user.click(screen.getByTestId('grant-submit'));

    const fetchMock = window.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({
      identifier: { email: 'jane@example.com', name: 'Jane Doe' },
    });
  });

  it('shows an inline validation error and does not POST for a bad identifier', async () => {
    const user = userEvent.setup();
    render(<GrantFounderPage />);
    await user.type(screen.getByTestId('identifier-input'), 'not-anything-valid');
    await user.click(screen.getByTestId('grant-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/MEM-XXXX/);
    expect((window.fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
