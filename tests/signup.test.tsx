// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import SignupPage from '../src/pages/index';

const ORIGINAL_LOCATION = window.location;

beforeEach(() => {
  cleanup();
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_test_123' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);

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

describe('SignupPage', () => {
  it('renders the Arty section as the primary, payable membership', () => {
    render(<SignupPage />);

    const arty = screen.getByTestId('arty-section');
    expect(within(arty).getByText('The Arty Club')).toBeInTheDocument();
    // The signup form fields live inside the Arty section and are always shown.
    expect(within(arty).getByLabelText('Name')).toBeInTheDocument();
    expect(within(arty).getByLabelText('Email')).toBeInTheDocument();
    expect(within(arty).getByText('What membership gets you')).toBeInTheDocument();

    // The submit is the page's primary CTA, enabled by default (no card gate).
    const button = within(arty).getByTestId('arty-submit');
    expect(button).toHaveTextContent('Join the Arty Club · £5/month →');
    expect(button).toBeEnabled();

    // No radio-card / selectable layout any more — Arty is the only payable thing.
    expect(screen.queryByTestId('card-arty')).toBeNull();
    expect(screen.queryByTestId('card-cure')).toBeNull();
    expect(screen.queryByTestId('card-both')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByText(/Both Clubs/i)).toBeNull();
  });

  it('renders the CURE teaser strip below the Arty section', () => {
    render(<SignupPage />);

    const teaser = screen.getByTestId('cure-teaser');
    expect(within(teaser).getByText('CURE Club')).toBeInTheDocument();
    expect(within(teaser).getByText(/smaller, slower door/i)).toBeInTheDocument();
    expect(within(teaser).getByText(/£50\/month, by application/i)).toBeInTheDocument();

    // The teaser sits after the Arty section in document order (discovered by scroll).
    const arty = screen.getByTestId('arty-section');
    expect(arty.compareDocumentPosition(teaser) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the CURE teaser's Apply CTA is an anchor that links to /apply", () => {
    render(<SignupPage />);

    const applyLink = screen.getByTestId('cure-apply-link') as HTMLAnchorElement;
    expect(applyLink.tagName).toBe('A');
    expect(applyLink.textContent).toMatch(/Apply/);
    expect(applyLink.getAttribute('href')).toBe('/apply');
  });

  it('clicking the CURE Apply link does NOT POST to /api/checkout/create', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    // The teaser link is plain navigation to /apply, never a Stripe trigger.
    const applyLink = screen.getByTestId('cure-apply-link');
    await user.click(applyLink);

    expect((window.fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('POSTs an Arty checkout body to /api/checkout/create on valid submit', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    await user.type(screen.getByLabelText('Name'), 'Jane Doe');
    await user.type(screen.getByLabelText('Email'), 'jane@example.com');
    await user.type(
      screen.getByLabelText(/Anything you'd like us to know/),
      'Looking forward to it',
    );
    await user.click(
      screen.getByLabelText(/I'd like to hear about Artyst events/),
    );

    await user.click(screen.getByTestId('arty-submit'));

    const fetchMock = window.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/checkout/create');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      product: 'arty',
      name: 'Jane Doe',
      email: 'jane@example.com',
      signup_message: 'Looking forward to it',
      marketing_consent: true,
    });
  });

  it('shows a validation error and does not POST when submitted with missing fields', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    await user.click(screen.getByTestId('arty-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Name is required/);
    expect((window.fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
