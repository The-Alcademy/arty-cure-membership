// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import WelcomePage from '../src/pages/welcome';

function setLocation(href: string) {
  const url = new URL(href);
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      href: url.href,
      search: url.search,
      pathname: url.pathname,
      origin: url.origin,
      host: url.host,
      hostname: url.hostname,
      protocol: url.protocol,
      port: url.port,
      hash: url.hash,
    } as Location,
  });
}

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function flushPromises(n = 5) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await flushPromises();
  });
}

beforeEach(() => {
  cleanup();
  vi.useFakeTimers();
  setLocation('http://localhost/welcome?session_id=cs_test_abc');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

describe('WelcomePage', () => {
  it('shows the polling status immediately on mount', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ready: false })));
    render(<WelcomePage />);
    expect(screen.getByTestId('welcome-polling')).toHaveTextContent('Welcoming you in...');
  });

  it('polls /api/membership/by-session every 2 seconds and stops on ready', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ready: false }))
      .mockResolvedValueOnce(jsonResponse({ ready: false }))
      .mockResolvedValueOnce(
        jsonResponse({
          ready: true,
          name: 'Jane Doe',
          member_number: 'MEM-0042',
          arty: true,
          cure: false,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(<WelcomePage />);

    expect(fetchMock).not.toHaveBeenCalled();

    await tick(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/membership/by-session?session_id=cs_test_abc',
    );

    await tick(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await tick(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await tick(0);
    expect(screen.getByTestId('welcome-ready')).toBeInTheDocument();

    await tick(10000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('renders the personalised headline, member number and QR code when ready', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          ready: true,
          name: 'Jane Doe',
          member_number: 'MEM-0042',
          arty: true,
          cure: true,
        }),
      ),
    );

    render(<WelcomePage />);
    await tick(2000);

    expect(
      screen.getByRole('heading', {
        name: 'Welcome to the Arty Club & CURE Club, Jane.',
      }),
    ).toBeInTheDocument();

    expect(screen.getByTestId('member-number')).toHaveTextContent(
      'Your member number is MEM-0042',
    );

    expect(screen.getByText(/Show this number or QR at the bar/)).toBeInTheDocument();

    await tick(0);
    const img = screen.getByAltText('QR code for MEM-0042') as HTMLImageElement;
    expect(img.src.startsWith('data:image')).toBe(true);

    expect(
      screen.getByText('10% off all food and drink at the Artyst'),
    ).toBeInTheDocument();
  });

  it('uses the CURE-only headline for cure:true arty:false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          ready: true,
          name: 'Sam Singh',
          member_number: 'MEM-0099',
          arty: false,
          cure: true,
        }),
      ),
    );

    render(<WelcomePage />);
    await tick(2000);

    expect(
      screen.getByRole('heading', {
        name: 'Welcome to the CURE Club, Sam.',
      }),
    ).toBeInTheDocument();
  });

  it('shows the fallback message after 30 seconds without ready:true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ready: false })));

    render(<WelcomePage />);

    for (let i = 0; i < 15; i++) {
      await tick(2000);
    }

    expect(screen.getByTestId('welcome-timeout')).toHaveTextContent(
      /We're processing your subscription/,
    );
    expect(
      screen.getByText(/contact matthew@othersyde\.co\.uk/),
    ).toBeInTheDocument();
  });
});
