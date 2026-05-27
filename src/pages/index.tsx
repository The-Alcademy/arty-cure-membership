import { useState } from 'react';
import clubsData from '../content/clubs.json';
import benefitsData from '../content/benefits.json';

// Homepage v3 — Arty Club is the primary, self-serve subscription and the only
// payable thing on this page. CURE is by application: a teaser strip sits below
// the Arty signup and links to /apply, where the substantive CURE story lives.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatPrice(pence: number): string {
  return `£${(pence / 100).toFixed(0)}/month`;
}

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [signupMessage, setSignupMessage] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const artyButtonLabel = `Join the Arty Club · ${formatPrice(clubsData.arty.price_pence)} →`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setError('Please enter a valid email.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/checkout/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: 'arty',
          name: name.trim(),
          email: email.trim(),
          signup_message: signupMessage.trim(),
          marketing_consent: marketingConsent,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ? `Could not start checkout: ${body.error}` : 'Could not start checkout. Please try again.');
        setSubmitting(false);
        return;
      }
      const { url } = await res.json();
      if (url) {
        window.location.href = url;
      } else {
        setError('Checkout did not return a redirect URL.');
        setSubmitting(false);
      }
    } catch {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <main className="page">
      <header className="hero">
        <h1>The Arty Club &amp; CURE Club</h1>
        <p>Two clubs at the Artyst. One conviction: arts and wellbeing are inseparable.</p>
      </header>

      {/* ── Arty Club — the primary, payable membership ───────────────── */}
      <section className="arty-section" data-testid="arty-section">
        <h2>{clubsData.arty.name}</h2>
        <span className="tagline">{clubsData.arty.tagline}</span>
        <p className="arty-intro">{clubsData.arty.description}</p>

        <form className="signup" onSubmit={handleSubmit} noValidate>
          <div className="form">
            <div className="row">
              <label htmlFor="name">Name</label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
                autoComplete="name"
              />
            </div>

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

            <div className="row">
              <label htmlFor="signup_message">Anything you'd like us to know? (optional)</label>
              <textarea
                id="signup_message"
                value={signupMessage}
                onChange={(e) => setSignupMessage(e.target.value)}
                maxLength={500}
              />
            </div>

            <div className="row consent">
              <input
                id="marketing_consent"
                type="checkbox"
                checked={marketingConsent}
                onChange={(e) => setMarketingConsent(e.target.checked)}
              />
              <label htmlFor="marketing_consent">
                I'd like to hear about Artyst events, tours and programmes by email
              </label>
            </div>
          </div>

          <section className="benefits">
            <h3>What membership gets you</h3>
            <ul>
              {benefitsData.benefits.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </section>

          <button
            type="submit"
            className="submit"
            disabled={submitting}
            data-testid="arty-submit"
          >
            {submitting ? 'Starting checkout…' : artyButtonLabel}
          </button>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      </section>

      {/* ── CURE Club — teaser strip, discovered by scroll ────────────── */}
      <aside className="cure-teaser" data-testid="cure-teaser">
        <h2>{clubsData.cure.name}</h2>
        <span className="tagline">{clubsData.cure.tagline}</span>
        <p>{clubsData.cure.teaser}</p>
        <a
          className="cure-teaser-link"
          href={clubsData.cure.apply_url}
          data-testid="cure-apply-link"
        >
          Apply →
        </a>
      </aside>

      <footer className="footer">
        <p>
          Already running events at the Artyst? Membership is required for event runners — same signup, same price.
        </p>
        <p>
          <a href="#terms">Terms</a>
          <a href="#faq">FAQ</a>
        </p>
      </footer>
    </main>
  );
}
