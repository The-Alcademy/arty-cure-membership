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
  it('renders two pricing cards with correct prices and no Both card', () => {
    render(<SignupPage />);

    const arty = screen.getByTestId('card-arty');
    const cure = screen.getByTestId('card-cure');

    expect(within(arty).getByText('The Arty Club')).toBeInTheDocument();
    expect(within(arty).getByText('£5/month')).toBeInTheDocument();

    expect(within(cure).getByText('CURE Club')).toBeInTheDocument();
    expect(within(cure).getByText('£50/month')).toBeInTheDocument();
    expect(within(cure).getByText(/By application/i)).toBeInTheDocument();

    // The v1 "Both" card must not appear in v2.
    expect(screen.queryByTestId('card-both')).toBeNull();
    expect(screen.queryByText(/Both Clubs/i)).toBeNull();
  });

  it('shows the Arty button label and does not vary by selection', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    // The button label is fixed: "Join the Arty Club · £5/month →".
    // The button is disabled until Arty is selected, but the label itself
    // doesn't depend on the selection any more.
    const button = screen.getByTestId('arty-submit');
    expect(button).toHaveTextContent('Join the Arty Club · £5/month →');
    expect(button).toBeDisabled();

    await user.click(within(screen.getByTestId('card-arty')).getByRole('radio'));
    expect(screen.getByTestId('arty-submit')).toHaveTextContent(
      'Join the Arty Club · £5/month →',
    );
    expect(screen.getByTestId('arty-submit')).toBeEnabled();
  });

  it("CURE card's Apply CTA is a mailto link with the right subject and recipient", () => {
    render(<SignupPage />);

    const applyLink = screen.getByTestId('cure-apply-link') as HTMLAnchorElement;
    expect(applyLink.tagName).toBe('A');
    expect(applyLink.textContent).toMatch(/Apply/);

    const href = applyLink.getAttribute('href') ?? '';
    expect(href.startsWith('mailto:matthew@othersyde.co.uk')).toBe(true);

    // Subject + body should round-trip via URL decoding.
    const url = new URL(href);
    expect(url.searchParams.get('subject')).toBe('CURE Club application');
    const body = url.searchParams.get('body') ?? '';
    expect(body).toMatch(/Hi Matthew/);
    expect(body).toMatch(/CURE Club/);
    expect(body).toMatch(/\[Tell me a bit about yourself\]/);
  });

  it('clicking the CURE Apply link does NOT POST to /api/checkout/create', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    // jsdom won't follow mailto: navigation but we still want to confirm no
    // checkout call fires.
    const applyLink = screen.getByTestId('cure-apply-link');
    await user.click(applyLink);

    expect((window.fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('POSTs an Arty checkout body to /api/checkout/create on valid submit', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    await user.click(within(screen.getByTestId('card-arty')).getByRole('radio'));
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

  it('shows a validation error and does not POST when Arty is submitted with missing fields', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    await user.click(within(screen.getByTestId('card-arty')).getByRole('radio'));
    await user.click(screen.getByTestId('arty-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Name is required/);
    expect((window.fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
