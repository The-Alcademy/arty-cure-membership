import { useState } from 'react';

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

export default function ManagePage() {
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
