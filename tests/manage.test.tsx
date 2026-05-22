// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import ManagePage from '../src/pages/manage';

const ORIGINAL_LOCATION = window.location;

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  cleanup();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href: '' } as Location,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: ORIGINAL_LOCATION,
  });
});

describe('ManagePage', () => {
  it('renders the title, instruction and email input', () => {
    render(<ManagePage />);
    expect(
      screen.getByRole('heading', { name: 'Manage your membership' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('shows an inline error and does not POST when the email is invalid', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<ManagePage />);
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please enter a valid email.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs to /api/membership/manage and redirects to the returned url on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { url: 'https://billing.stripe.com/p/session/test_redirect' },
        200,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<ManagePage />);
    await user.type(screen.getByLabelText('Email'), 'manage@example.com');
    await user.click(screen.getByRole('button'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/membership/manage');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'manage@example.com' });

    await vi.waitFor(() => {
      expect(window.location.href).toBe(
        'https://billing.stripe.com/p/session/test_redirect',
      );
    });
  });

  it('shows the not-found message when the endpoint returns 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: 'member_not_found' }, 404),
    );
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<ManagePage />);
    await user.type(screen.getByLabelText('Email'), 'nobody@example.com');
    await user.click(screen.getByRole('button'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't find a membership for that email/,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      /contact matthew@othersyde\.co\.uk/,
    );
    expect(window.location.href).toBe('');
  });
});
