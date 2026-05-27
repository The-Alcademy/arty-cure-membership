// ─────────────────────────────────────────────────────────────────
// src/pages/admin/grant-founder.tsx
//
// Admin-only page that grants CURE founder status. Two modes via radio:
//   - Promote existing member (single text field: MEM-XXXX or email)
//   - Create new founder       (name + email)
//
// Auth: the page prompts for the ADMIN_TOKEN once and caches it in
// sessionStorage. Same-tab navigation keeps it; closing the tab clears it.
// All API calls go out with Authorization: Bearer <token>.
// ─────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const ADMIN_TOKEN_KEY = 'admin_token';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MEM_RE   = /^MEM-\d+$/i;

type Mode = 'promote' | 'create';

type GrantResult = {
  member_number:  string;
  founder_number: string | null;
  name:           string;
  email:          string;
  tier:           string;
  was_existing:   boolean;
};

type State =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; result: GrantResult }
  | { kind: 'error'; message: string };

function readAdminToken(): string | null {
  try {
    return window.sessionStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeAdminToken(token: string | null) {
  try {
    if (token) window.sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    else       window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // sessionStorage may be blocked; silently no-op.
  }
}

export default function GrantFounderPage(): React.ReactElement {
  const [token, setToken]       = useState<string | null>(() => readAdminToken());
  const [mode, setMode]         = useState<Mode>('promote');
  const [identifier, setIdent]  = useState('');
  const [newName, setNewName]   = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [state, setState]       = useState<State>({ kind: 'idle' });

  // Prompt for the admin token once, only if we don't already have one.
  // Using window.prompt keeps the UI minimal — the page is admin-internal,
  // not user-facing. A nicer flow lands when proper admin auth ships.
  useEffect(() => {
    if (token) return;
    const entered = window.prompt('Admin token:') ?? '';
    if (entered.trim().length > 0) {
      const t = entered.trim();
      writeAdminToken(t);
      setToken(t);
    }
  }, [token]);

  function reset() {
    setIdent('');
    setNewName('');
    setNewEmail('');
    setState({ kind: 'idle' });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      setState({ kind: 'error', message: 'Admin token missing. Reload and enter it when prompted.' });
      return;
    }

    let body: { identifier: string | { email: string; name: string } };
    if (mode === 'promote') {
      const v = identifier.trim();
      if (!MEM_RE.test(v) && !EMAIL_RE.test(v)) {
        setState({ kind: 'error', message: 'Enter a MEM-XXXX number or an email address.' });
        return;
      }
      body = { identifier: v };
    } else {
      const name  = newName.trim();
      const email = newEmail.trim();
      if (!name) {
        setState({ kind: 'error', message: 'Name is required.' });
        return;
      }
      if (!EMAIL_RE.test(email)) {
        setState({ kind: 'error', message: 'Please enter a valid email.' });
        return;
      }
      body = { identifier: { email, name } };
    }

    setState({ kind: 'submitting' });
    try {
      const res = await fetch('/api/admin/grant-founder', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 200) {
        setState({ kind: 'success', result: json as GrantResult });
        return;
      }
      if (res.status === 401) {
        // Token wrong — clear it so the next render re-prompts.
        writeAdminToken(null);
        setToken(null);
        setState({ kind: 'error', message: 'Admin token rejected. Reload and try again.' });
        return;
      }
      if (res.status === 409 && json?.error === 'already_founder') {
        setState({
          kind:    'error',
          message: `Already a founder: ${json.member_number ?? '(unknown MEM)'} → ${json.founder_number ?? '(unknown FND)'}.`,
        });
        return;
      }
      if (res.status === 409 && json?.error === 'member_exists') {
        setState({
          kind:    'error',
          message: `A member with that email already exists (${json.member_number ?? '?'}). Use Promote mode to grant them founder status.`,
        });
        return;
      }
      setState({
        kind:    'error',
        message: json?.error ? `Server: ${json.error}${json.message ? ` — ${json.message}` : ''}` : `Server: HTTP ${res.status}`,
      });
    } catch (err: any) {
      setState({ kind: 'error', message: `Network error: ${err?.message ?? String(err)}` });
    }
  }

  return (
    <main className="page" data-testid="grant-founder-page">
      <header className="hero">
        <h1>Grant founder status</h1>
        <p>Admin only. Promote an existing member, or create a new founder directly.</p>
      </header>

      {state.kind === 'success' ? (
        <section className="grant-result" data-testid="grant-result">
          <p>
            Granted founder status. <strong data-testid="grant-mem">{state.result.member_number}</strong>{' '}
            is now <strong data-testid="grant-fnd">{state.result.founder_number ?? '(no FND assigned)'}</strong>.
          </p>
          <p className="grant-result-meta">
            {state.result.was_existing ? 'Promoted from an existing member.' : 'Created as a brand-new founder row.'}
            {' '}
            ({state.result.name} · {state.result.email})
          </p>
          <button type="button" className="submit" onClick={reset} data-testid="grant-another">
            Grant another
          </button>
        </section>
      ) : (
        <form className="signup" onSubmit={handleSubmit} noValidate>
          <fieldset className="cards" role="radiogroup" aria-label="Grant mode">
            <legend className="sr-only">Mode</legend>
            <label
              className={`card ${mode === 'promote' ? 'selected' : ''}`}
              data-testid="mode-promote"
            >
              <input
                type="radio"
                name="mode"
                value="promote"
                checked={mode === 'promote'}
                onChange={() => setMode('promote')}
              />
              <span className="name">Promote existing member</span>
            </label>
            <label
              className={`card ${mode === 'create' ? 'selected' : ''}`}
              data-testid="mode-create"
            >
              <input
                type="radio"
                name="mode"
                value="create"
                checked={mode === 'create'}
                onChange={() => setMode('create')}
              />
              <span className="name">Create new founder</span>
            </label>
          </fieldset>

          {mode === 'promote' ? (
            <div className="form">
              <div className="row">
                <label htmlFor="identifier">MEM-XXXX or email</label>
                <input
                  id="identifier"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdent(e.target.value)}
                  data-testid="identifier-input"
                  required
                  autoComplete="off"
                />
              </div>
            </div>
          ) : (
            <div className="form">
              <div className="row">
                <label htmlFor="new-name">Name</label>
                <input
                  id="new-name"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  data-testid="new-name-input"
                  maxLength={100}
                  required
                />
              </div>
              <div className="row">
                <label htmlFor="new-email">Email</label>
                <input
                  id="new-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  data-testid="new-email-input"
                  required
                  autoComplete="off"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            className="submit"
            disabled={state.kind === 'submitting'}
            data-testid="grant-submit"
          >
            {state.kind === 'submitting' ? 'Granting…' : 'Grant founder status →'}
          </button>

          {state.kind === 'error' && (
            <p className="error" role="alert">{state.message}</p>
          )}
        </form>
      )}
    </main>
  );
}

// ─── Mount ──────────────────────────────────────────────────────
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <GrantFounderPage />
    </React.StrictMode>,
  );
}
