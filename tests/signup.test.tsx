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
  it('renders the three pricing cards with names and prices', () => {
    render(<SignupPage />);

    const arty = screen.getByTestId('card-arty');
    const cure = screen.getByTestId('card-cure');
    const both = screen.getByTestId('card-both');

    expect(within(arty).getByText('The Arty Club')).toBeInTheDocument();
    expect(within(arty).getByText('£5/month')).toBeInTheDocument();

    expect(within(cure).getByText('CURE Club')).toBeInTheDocument();
    expect(within(cure).getByText('£5/month')).toBeInTheDocument();

    expect(within(both).getByText('Both Clubs')).toBeInTheDocument();
    expect(within(both).getByText('£8/month')).toBeInTheDocument();
    expect(within(both).getByText(/Saves £2\/month/)).toBeInTheDocument();
  });

  it('updates the submit button label when a card is selected', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Choose a club to continue');

    await user.click(within(screen.getByTestId('card-arty')).getByRole('radio'));
    expect(screen.getByRole('button')).toHaveTextContent('Join the Arty Club · £5/month →');

    await user.click(within(screen.getByTestId('card-cure')).getByRole('radio'));
    expect(screen.getByRole('button')).toHaveTextContent('Join the CURE Club · £5/month →');

    await user.click(within(screen.getByTestId('card-both')).getByRole('radio'));
    expect(screen.getByRole('button')).toHaveTextContent('Join Both Clubs · £8/month →');
  });

  it('POSTs the expected body to /api/checkout/create on valid submit', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    await user.click(within(screen.getByTestId('card-both')).getByRole('radio'));
    await user.type(screen.getByLabelText('Name'), 'Jane Doe');
    await user.type(screen.getByLabelText('Email'), 'jane@example.com');
    await user.type(
      screen.getByLabelText(/Anything you'd like us to know/),
      'Looking forward to it',
    );
    await user.click(
      screen.getByLabelText(/I'd like to hear about Artyst events/),
    );

    await user.click(screen.getByRole('button'));

    const fetchMock = window.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/checkout/create');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      product: 'both',
      name: 'Jane Doe',
      email: 'jane@example.com',
      signup_message: 'Looking forward to it',
      marketing_consent: true,
    });
  });

  it('shows a validation error and does not POST when submitted with missing fields', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    await user.click(within(screen.getByTestId('card-arty')).getByRole('radio'));
    await user.click(screen.getByRole('button'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Name is required/);
    expect((window.fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
