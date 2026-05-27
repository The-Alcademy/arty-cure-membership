import { useState } from 'react';
import clubsData from '../content/clubs.json';
import benefitsData from '../content/benefits.json';

// v2 — Arty is the only self-serve subscription. CURE is by application:
// the card surfaces a mailto CTA until the dedicated /apply page ships
// (Goal 11 in spec/MEMBERSHIP.md §12).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatPrice(pence: number): string {
  return `£${(pence / 100).toFixed(0)}/month`;
}

// Build the mailto: URL for CURE applications. Subject and body are
// URL-encoded so apostrophes, commas, and line breaks round-trip cleanly
// across mail clients.
function cureMailtoHref(email: string): string {
  const subject = encodeURIComponent('CURE Club application');
  const body = encodeURIComponent(
    "Hi Matthew, I'd like to apply to join the CURE Club.\n\n[Tell me a bit about yourself]",
  );
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

export default function SignupPage() {
  // Only Arty is selectable in v2 — the CURE card is a mailto link, not a
  // radio option. We keep a single-selection bool so the existing
  // "form revealed after a card is picked" pattern still applies.
  const [artySelected, setArtySelected] = useState(false);
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

    if (!artySelected) {
      setError('Please choose a club above.');
      return;
    }
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

      <section className="club-paragraphs">
        <article>
          <h2>{clubsData.arty.name}</h2>
          <span className="tagline">{clubsData.arty.tagline}</span>
          <p>{clubsData.arty.description}</p>
        </article>
        <article>
          <h2>{clubsData.cure.name}</h2>
          <span className="tagline">{clubsData.cure.tagline}</span>
          <p>{clubsData.cure.description}</p>
        </article>
      </section>

      <form className="signup" onSubmit={handleSubmit} noValidate>
        <fieldset className="cards" aria-label="Choose a membership">
          <legend className="sr-only">Membership</legend>

          {/* Arty — self-serve radio card */}
          <label
            className={`card ${artySelected ? 'selected' : ''}`}
            data-testid="card-arty"
          >
            <input
              type="radio"
              name="product"
              value="arty"
              checked={artySelected}
              onChange={() => setArtySelected(true)}
            />
            <span className="name">{clubsData.arty.name}</span>
            <span className="price">{formatPrice(clubsData.arty.price_pence)}</span>
          </label>

          {/* CURE — mailto CTA card (no radio; opens email client) */}
          <div className="card card-cure" data-testid="card-cure">
            <span className="name">{clubsData.cure.name}</span>
            <span className="price">{formatPrice(clubsData.cure.price_pence)}</span>
            <span className="cure-subtext">{clubsData.cure.apply_subtext}</span>
            <a
              className="cure-apply"
              href={cureMailtoHref(clubsData.cure.apply_email)}
              data-testid="cure-apply-link"
            >
              Apply →
            </a>
          </div>
        </fieldset>

        {artySelected && (
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
        )}

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
          disabled={!artySelected || submitting}
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
