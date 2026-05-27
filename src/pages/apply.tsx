// ─────────────────────────────────────────────────────────────────
// src/pages/apply.tsx
//
// CURE Club application page. Renders the canonical five-question
// questionnaire (api/_lib/apply-questions.json), POSTs to
// /api/membership/apply, and shows a confirmation on success.
// ─────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
// Lives under api/_lib/ (not src/content/) so Vercel's serverless bundler
// includes it for /api/membership/apply; Vite resolves it for the page from here.
import questions from '../../api/_lib/apply-questions.json';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Question = {
  id: string;
  label: string;
  helper_text: string;
  max_chars: number;
  required: boolean;
};

const QUESTIONS = questions as Question[];

const helperStyle: React.CSSProperties = {
  fontSize: '0.82rem',
  color: 'var(--color-faint)',
  margin: '0 0 8px',
  fontStyle: 'italic',
};

const counterStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  color: 'var(--color-faint)',
  textAlign: 'right',
  marginTop: '4px',
};

const successStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: '10px',
  padding: '28px',
  fontSize: '1.1rem',
  lineHeight: 1.6,
  color: 'var(--color-text)',
};

export default function ApplyPage(): React.ReactElement {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>(
    () => Object.fromEntries(QUESTIONS.map((q) => [q.id, ''])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const requiredFilled = QUESTIONS.filter((q) => q.required).every(
    (q) => (answers[q.id] ?? '').trim().length > 0,
  );
  const canSubmit =
    name.trim().length > 0 && EMAIL_RE.test(email.trim()) && requiredFilled;

  const setAnswer = (id: string, value: string) =>
    setAnswers((prev) => ({ ...prev, [id]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Please tell us your name.');
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError('Please enter a valid email.');
      return;
    }
    if (!requiredFilled) {
      setError('Please answer the four required questions.');
      return;
    }

    const questionnaire = Object.fromEntries(
      QUESTIONS.map((q) => [q.id, (answers[q.id] ?? '').trim()]),
    );

    setSubmitting(true);
    try {
      const res = await fetch('/api/membership/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          questionnaire,
        }),
      });

      if (res.status === 409) {
        // Already applied — treat as a soft success so they aren't nagged.
        setSubmittedEmail(email.trim());
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        setError('Something went wrong sending your application. Please try again.');
        setSubmitting(false);
        return;
      }

      setSubmittedEmail(email.trim());
      setSubmitting(false);
    } catch {
      setError('Network error. Please check your connection and try again.');
      setSubmitting(false);
    }
  };

  return (
    <main className="page">
      <header className="hero">
        <h1>Apply to the CURE Club</h1>
        <p>
          The inner-circle membership, by application. Tell Matthew a little about
          yourself — then a 45-minute conversation at the Artyst.
        </p>
      </header>

      {submittedEmail ? (
        <section style={successStyle} role="status" data-testid="apply-success">
          Thanks. We've got your application. A confirmation is on its way to{' '}
          {submittedEmail}. Matthew will be in touch within a week.
        </section>
      ) : (
        <form className="form" onSubmit={handleSubmit} noValidate>
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

          {QUESTIONS.map((q) => (
            <div className="row" key={q.id}>
              <label htmlFor={q.id}>
                {q.label}
                {q.required ? '' : ' (optional)'}
              </label>
              <p style={helperStyle}>{q.helper_text}</p>
              <textarea
                id={q.id}
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswer(q.id, e.target.value)}
                maxLength={q.max_chars}
                required={q.required}
              />
              <div style={counterStyle} data-testid={`counter-${q.id}`}>
                {(answers[q.id] ?? '').length} / {q.max_chars}
              </div>
            </div>
          ))}

          <button
            type="submit"
            className="submit"
            disabled={!canSubmit || submitting}
            data-testid="apply-submit"
          >
            {submitting ? 'Submitting…' : 'Submit application →'}
          </button>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </main>
  );
}

// ─── Mount ──────────────────────────────────────────────────────
// Guarded so importing this module in tests (jsdom, no #root) is a no-op.
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <ApplyPage />
    </React.StrictMode>,
  );
}
