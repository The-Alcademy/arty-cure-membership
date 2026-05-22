import { useMemo, useState } from 'react';
import clubsData from '../content/clubs.json';
import benefitsData from '../content/benefits.json';

type Product = 'arty' | 'cure' | 'both';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ORDER: Product[] = ['arty', 'cure', 'both'];

function formatPrice(pence: number): string {
  return `£${(pence / 100).toFixed(0)}/month`;
}

function buttonLabelFor(selected: Product | null): string {
  if (!selected) return 'Choose a club to continue';
  const price = formatPrice(clubsData[selected].price_pence);
  if (selected === 'arty') return `Join the Arty Club · ${price} →`;
  if (selected === 'cure') return `Join the CURE Club · ${price} →`;
  return `Join Both Clubs · ${price} →`;
}

export default function SignupPage() {
  const [selected, setSelected] = useState<Product | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [signupMessage, setSignupMessage] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const buttonLabel = useMemo(() => buttonLabelFor(selected), [selected]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selected) {
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
          product: selected,
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
        <fieldset className="cards" role="radiogroup" aria-label="Choose a membership">
          <legend className="sr-only">Membership</legend>
          {ORDER.map((key) => {
            const club = clubsData[key];
            const isSelected = selected === key;
            return (
              <label
                key={key}
                className={`card ${isSelected ? 'selected' : ''}`}
                data-testid={`card-${key}`}
              >
                <input
                  type="radio"
                  name="product"
                  value={key}
                  checked={isSelected}
                  onChange={() => setSelected(key)}
                />
                <span className="name">{club.name}</span>
                <span className="price">{formatPrice(club.price_pence)}</span>
                {key === 'both' && (
                  <span className="savings">Saves £2/month vs joining separately</span>
                )}
              </label>
            );
          })}
        </fieldset>

        {selected && (
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
          disabled={!selected || submitting}
        >
          {submitting ? 'Starting checkout…' : buttonLabel}
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
