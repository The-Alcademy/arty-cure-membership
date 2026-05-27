import { useEffect, useState } from 'react';
import { deriveTier, isActive } from '../lib/deriveTier';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ErrorKind = 'invalid_email' | 'not_found' | 'generic' | null;

function errorMessage(kind: ErrorKind): string | null {
  if (kind === 'invalid_email') return 'Please enter a valid email.';
  if (kind === 'not_found') {
    return "We couldn't find a membership for that email. Check the address or contact matthew@othersyde.co.uk.";
  }
  if (kind === 'generic') return 'Something went wrong. Please try again.';
  return null;
}

// ─── Member context (token-branch) types ───────────────────────────

type Member = {
  member_number:    string;
  name:             string;
  email:            string;
  arty_active:      boolean;
  cure_active:      boolean;
  arty_joined_at?:  string | null;
  cure_joined_at?:  string | null;
};

type CtxState =
  | { kind: 'loading' }
  | { kind: 'ready'; member: Member }
  | { kind: 'fallback' };          // token absent / invalid → show email form

function readTokenFromUrl(): string | null {
  // Defensive: tests stub window.location to { href: '' } with no .search.
  const search = (window.location && window.location.search) || '';
  if (!search) return null;
  const params = new URLSearchParams(search);
  const t = params.get('token');
  return t && t.length > 0 ? t : null;
}

// "Joined" date is the earliest of arty_joined_at and cure_joined_at. Rendered
// as a short British-English date — the spec asks for "Joined [date]" and the
// existing welcome email/page style is Georgia/serif.
function joinedLabel(m: Member): string | null {
  const candidates = [m.arty_joined_at, m.cure_joined_at]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .map((s) => new Date(s).getTime())
    .filter((n) => Number.isFinite(n));
  if (candidates.length === 0) return null;
  const earliest = Math.min(...candidates);
  return new Date(earliest).toLocaleDateString('en-GB', {
    day:   'numeric',
    month: 'long',
    year:  'numeric',
  });
}

export default function ManagePage() {
  const [ctx, setCtx] = useState<CtxState>(() => {
    // Synchronously decide whether we're in the token branch so the
    // initial render doesn't flash the email form.
    return readTokenFromUrl() ? { kind: 'loading' } : { kind: 'fallback' };
  });

  useEffect(() => {
    const token = readTokenFromUrl();
    if (!token) return;
    let cancelled = false;
    fetch('/api/membership/me?token=' + encodeURIComponent(token))
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setCtx({ kind: 'fallback' });
          return;
        }
        const body = (await res.json().catch(() => null)) as Member | null;
        if (!body || typeof body.member_number !== 'string') {
          if (!cancelled) setCtx({ kind: 'fallback' });
          return;
        }
        if (!cancelled) setCtx({ kind: 'ready', member: body });
      })
      .catch(() => {
        if (!cancelled) setCtx({ kind: 'fallback' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (ctx.kind === 'loading') {
    return (
      <main className="page" data-testid="manage-loading">
        <header className="hero">
          <h1>Manage your membership</h1>
        </header>
        <p className="manage-loading">Loading your membership…</p>
      </main>
    );
  }

  if (ctx.kind === 'ready') {
    return (
      <MemberContextView
        member={ctx.member}
        onRefresh={async () => {
          const token = readTokenFromUrl();
          if (!token) return;
          const res = await fetch(
            '/api/membership/me?token=' + encodeURIComponent(token),
          );
          if (!res.ok) return;
          const body = (await res.json().catch(() => null)) as Member | null;
          if (body && typeof body.member_number === 'string') {
            setCtx({ kind: 'ready', member: body });
          }
        }}
      />
    );
  }

  return <EmailFallbackForm />;
}

// ─── Email fallback form (unchanged behaviour, just extracted) ────

function EmailFallbackForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<ErrorKind>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!EMAIL_RE.test(email.trim())) {
      setError('invalid_email');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/membership/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.status === 200) {
        const body = await res.json().catch(() => ({}));
        if (body && typeof body.url === 'string') {
          window.location.href = body.url;
          return;
        }
        setError('generic');
        setSubmitting(false);
        return;
      }
      if (res.status === 404) {
        setError('not_found');
        setSubmitting(false);
        return;
      }
      if (res.status === 400) {
        setError('invalid_email');
        setSubmitting(false);
        return;
      }
      setError('generic');
      setSubmitting(false);
    } catch {
      setError('generic');
      setSubmitting(false);
    }
  };

  const message = errorMessage(error);

  return (
    <main className="page">
      <header className="hero">
        <h1>Manage your membership</h1>
        <p>
          Enter the email you signed up with. We'll send you to the Stripe portal where
          you can update your card, change clubs, or cancel.
        </p>
      </header>

      <form className="manage" onSubmit={handleSubmit} noValidate>
        <div className="form">
          <div className="row">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
        </div>

        <button type="submit" className="submit" disabled={submitting}>
          {submitting ? 'Opening portal…' : 'Continue to Stripe portal →'}
        </button>

        {message && (
          <p className="error" role="alert">
            {message}
          </p>
        )}
      </form>
    </main>
  );
}

// ─── Member-context view (token branch) ───────────────────────────

function MemberContextView({
  member,
  onRefresh,
}: {
  member: Member;
  onRefresh: () => Promise<void>;
}) {
  const tier = deriveTier(member);
  const active = isActive(member);
  const joined = joinedLabel(member);

  const [portalLoading, setPortalLoading] = useState<null | 'payment' | 'invoices'>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelState, setCancelState] = useState<
    | { kind: 'idle' }
    | { kind: 'pending' }
    | { kind: 'done'; periodEnd: string | null }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  async function openPortal(kind: 'payment' | 'invoices') {
    setPortalError(null);
    setPortalLoading(kind);
    try {
      const res = await fetch('/api/membership/manage', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: member.email }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 200 && body && typeof body.url === 'string') {
        // Same-tab navigation matches the existing email-form behaviour and
        // gives users a back-arrow path home.
        window.location.href = body.url;
        return;
      }
      setPortalError('Could not open the Stripe portal. Please try again.');
    } catch {
      setPortalError('Could not reach the server. Please try again.');
    } finally {
      setPortalLoading(null);
    }
  }

  async function handleConfirmCancel() {
    const token = readTokenFromUrl();
    if (!token) {
      setCancelState({ kind: 'error', message: 'Missing token. Please reopen this page from your pass.' });
      return;
    }
    setCancelState({ kind: 'pending' });
    try {
      const res = await fetch('/api/membership/cancel', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 200) {
        const periodEnd =
          body && typeof body.period_end === 'string' ? body.period_end : null;
        setCancelState({ kind: 'done', periodEnd });
        setConfirmOpen(false);
        await onRefresh();
        return;
      }
      setCancelState({
        kind:    'error',
        message: 'Could not cancel right now. Please try again or contact members@theartyst.co.uk.',
      });
    } catch {
      setCancelState({
        kind:    'error',
        message: 'Could not reach the server. Please try again.',
      });
    }
  }

  const cancelledPeriodEnd =
    cancelState.kind === 'done' && cancelState.periodEnd
      ? new Date(cancelState.periodEnd).toLocaleDateString('en-GB', {
          day:   'numeric',
          month: 'long',
          year:  'numeric',
        })
      : null;

  return (
    <main className="page" data-testid="manage-member-view">
      <header className="hero">
        <h1>Manage your membership</h1>
      </header>

      <section className="manage-card" data-testid="manage-card">
        <h2 className="manage-name">{member.name}</h2>
        <div className="manage-number" data-testid="manage-member-number">
          {member.member_number}
        </div>

        <div className="manage-badges">
          <span
            className="manage-badge"
            data-testid="manage-tier"
            style={{ background: tier.bg, color: tier.fg }}
          >
            {tier.label}
          </span>
          <span
            className="manage-badge"
            data-testid="manage-active-state"
            style={{ background: active ? '#1F7A3A' : '#888888', color: '#FFFFFF' }}
          >
            {active ? 'ACTIVE' : 'INACTIVE'}
          </span>
        </div>

        {joined && (
          <p className="manage-joined" data-testid="manage-joined">
            Joined {joined}
          </p>
        )}

        {cancelState.kind === 'done' && (
          <p className="manage-cancel-confirm" data-testid="manage-cancel-confirm">
            {cancelledPeriodEnd
              ? `Cancelled. You'll keep access until ${cancelledPeriodEnd}.`
              : "Cancelled. You'll keep access until the end of your current billing period."}
          </p>
        )}

        <div className="manage-actions">
          <button
            type="button"
            className="submit"
            data-testid="manage-update-payment"
            onClick={() => openPortal('payment')}
            disabled={portalLoading !== null}
          >
            {portalLoading === 'payment' ? 'Opening portal…' : 'Update payment method →'}
          </button>

          <button
            type="button"
            className="submit secondary"
            data-testid="manage-view-invoices"
            onClick={() => openPortal('invoices')}
            disabled={portalLoading !== null}
          >
            {portalLoading === 'invoices' ? 'Opening portal…' : 'View invoices →'}
          </button>

          <button
            type="button"
            className="manage-cancel-link"
            data-testid="manage-cancel-trigger"
            onClick={() => setConfirmOpen(true)}
          >
            Cancel subscription
          </button>
        </div>

        {portalError && (
          <p className="error" role="alert">{portalError}</p>
        )}
      </section>

      {confirmOpen && (
        <div
          className="manage-modal-backdrop"
          role="dialog"
          aria-modal="true"
          data-testid="manage-cancel-modal"
        >
          <div className="manage-modal">
            <h3>Cancel your subscription?</h3>
            <p>
              You'll retain access until the end of your current billing period.
              After that, you'll lose member benefits including the 10% F&amp;B discount.
            </p>
            {cancelState.kind === 'error' && (
              <p className="error" role="alert">{cancelState.message}</p>
            )}
            <div className="manage-modal-actions">
              <button
                type="button"
                className="submit secondary"
                data-testid="manage-cancel-keep"
                onClick={() => setConfirmOpen(false)}
                disabled={cancelState.kind === 'pending'}
              >
                Keep membership
              </button>
              <button
                type="button"
                className="submit danger"
                data-testid="manage-cancel-confirm-button"
                onClick={handleConfirmCancel}
                disabled={cancelState.kind === 'pending'}
              >
                {cancelState.kind === 'pending' ? 'Cancelling…' : 'Yes, cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
