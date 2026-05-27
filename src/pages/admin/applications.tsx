// ─────────────────────────────────────────────────────────────────
// src/pages/admin/applications.tsx
//
// Admin-only review queue for CURE Club applications.
//   - Lists applications (Pending by default; All toggle).
//   - Each card shows name, email, when it landed, an "Existing Arty
//     member" badge for upgrade candidates, and the full questionnaire.
//   - Accept → modal with optional notes → "Send checkout link". The
//     server creates a Stripe Checkout session and emails the link.
//   - Reject → modal with optional notes → "Send rejection" (understated).
//
// Auth: prompts for ADMIN_TOKEN once, caches it in sessionStorage, and
// sends it as Authorization: Bearer <token> — same pattern as
// src/pages/admin/grant-founder.tsx.
// ─────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import questions from '../../../api/_lib/apply-questions.json';

const ADMIN_TOKEN_KEY = 'admin_token';

type Question = { id: string; label: string };
const QUESTIONS = questions as Question[];
const QUESTION_LABELS: Record<string, string> = Object.fromEntries(
  QUESTIONS.map((q) => [q.id, q.label]),
);

type Application = {
  id: string;
  name: string;
  email: string;
  created_at: string;
  status: string;
  questionnaire: Record<string, unknown> | null;
  existing_member_email: string | null;
};

type Filter = 'pending' | 'all';

type ListState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; applications: Application[] };

type ModalState = null | { decision: 'accept' | 'reject'; application: Application };

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
    else window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // sessionStorage may be blocked; silently no-op.
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Build an ordered [label, answer] list: canonical questions first (in their
// declared order), then any extra keys the questionnaire happens to carry.
function questionnaireEntries(q: Record<string, unknown> | null): Array<[string, string]> {
  if (!q) return [];
  const out: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const def of QUESTIONS) {
    if (def.id in q) {
      seen.add(def.id);
      out.push([def.label, stringifyAnswer(q[def.id])]);
    }
  }
  for (const key of Object.keys(q)) {
    if (seen.has(key)) continue;
    out.push([QUESTION_LABELS[key] ?? key, stringifyAnswer(q[key])]);
  }
  return out;
}

function stringifyAnswer(v: unknown): string {
  if (typeof v === 'string') return v.trim() || '(no answer)';
  if (v === null || v === undefined) return '(no answer)';
  return String(v);
}

export default function ApplicationsPage(): React.ReactElement {
  const [token, setToken] = useState<string | null>(() => readAdminToken());
  const [filter, setFilter] = useState<Filter>('pending');
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [modal, setModal] = useState<ModalState>(null);
  const [notes, setNotes] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  // Prompt for the admin token once, only if we don't already have one.
  useEffect(() => {
    if (token) return;
    const entered = window.prompt('Admin token:') ?? '';
    if (entered.trim().length > 0) {
      const t = entered.trim();
      writeAdminToken(t);
      setToken(t);
    }
  }, [token]);

  const loadApplications = useCallback(async () => {
    if (!token) return;
    setList({ kind: 'loading' });
    try {
      const res = await fetch(`/api/admin/applications?status=${filter}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        writeAdminToken(null);
        setToken(null);
        setList({ kind: 'error', message: 'Admin token rejected. Reload and try again.' });
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (res.status !== 200) {
        setList({ kind: 'error', message: json?.error ? `Server: ${json.error}` : `Server: HTTP ${res.status}` });
        return;
      }
      setList({ kind: 'loaded', applications: (json.applications ?? []) as Application[] });
    } catch (err: any) {
      setList({ kind: 'error', message: `Network error: ${err?.message ?? String(err)}` });
    }
  }, [token, filter]);

  useEffect(() => {
    void loadApplications();
  }, [loadApplications]);

  function openModal(decision: 'accept' | 'reject', application: Application) {
    setModal({ decision, application });
    setNotes('');
    setDecideError(null);
  }

  function closeModal() {
    if (deciding) return;
    setModal(null);
    setNotes('');
    setDecideError(null);
  }

  async function submitDecision() {
    if (!modal || !token) return;
    const { decision, application } = modal;
    setDeciding(true);
    setDecideError(null);
    try {
      const res = await fetch('/api/admin/applications/decide', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          application_id: application.id,
          decision,
          notes: notes.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (res.status === 401) {
        writeAdminToken(null);
        setToken(null);
        setDecideError('Admin token rejected. Reload and try again.');
        return;
      }
      if (res.status === 200) {
        setModal(null);
        setNotes('');
        setConfirmation(
          decision === 'accept'
            ? `Accepted ${application.name}. Checkout link sent to ${application.email}.`
            : `Declined ${application.name}. A note has been sent to ${application.email}.`,
        );
        await loadApplications();
        return;
      }
      if (res.status === 409) {
        setDecideError('This application has already been decided. Refresh the list.');
        return;
      }
      if (res.status === 404) {
        setDecideError('Application not found. It may have been removed.');
        return;
      }
      setDecideError(json?.error ? `Server: ${json.error}` : `Server: HTTP ${res.status}`);
    } catch (err: any) {
      setDecideError(`Network error: ${err?.message ?? String(err)}`);
    } finally {
      setDeciding(false);
    }
  }

  return (
    <main className="page" data-testid="applications-page">
      <header className="hero">
        <h1>CURE applications</h1>
        <p>Admin only. Review applications, then send a checkout link or a note.</p>
      </header>

      <div className="applications-filter" role="group" aria-label="Filter applications">
        <button
          type="button"
          className={filter === 'pending' ? 'active' : ''}
          aria-pressed={filter === 'pending'}
          onClick={() => setFilter('pending')}
          data-testid="filter-pending"
        >
          Pending
        </button>
        <button
          type="button"
          className={filter === 'all' ? 'active' : ''}
          aria-pressed={filter === 'all'}
          onClick={() => setFilter('all')}
          data-testid="filter-all"
        >
          All
        </button>
      </div>

      {confirmation && (
        <p className="applications-confirm" role="status" data-testid="decide-confirmation">
          {confirmation}
        </p>
      )}

      {list.kind === 'loading' && (
        <p className="applications-status" data-testid="applications-loading">Loading…</p>
      )}

      {list.kind === 'error' && (
        <p className="error" role="alert" data-testid="applications-error">{list.message}</p>
      )}

      {list.kind === 'loaded' && list.applications.length === 0 && (
        <p className="applications-empty" data-testid="applications-empty">
          {filter === 'pending' ? 'No pending applications.' : 'No applications yet.'}
        </p>
      )}

      {list.kind === 'loaded' && list.applications.length > 0 && (
        <section className="applications-list">
          {list.applications.map((app) => (
            <article className="application-card" data-testid="application-card" key={app.id}>
              <div className="application-head">
                <span className="application-name">{app.name}</span>
                <span className="application-email">{app.email}</span>
                {app.existing_member_email && (
                  <span className="existing-member-badge" data-testid="existing-member-badge">
                    Existing Arty member
                  </span>
                )}
              </div>
              <p className="application-meta">
                {formatDate(app.created_at)}
                {app.status !== 'pending' && (
                  <span className="application-status-pill">{app.status}</span>
                )}
              </p>

              <div className="application-qa">
                {questionnaireEntries(app.questionnaire).map(([label, answer], i) => (
                  <div key={i}>
                    <p className="qa-q">{label}</p>
                    <p className="qa-a">{answer}</p>
                  </div>
                ))}
              </div>

              {app.status === 'pending' && (
                <div className="application-actions">
                  <button
                    type="button"
                    className="submit"
                    onClick={() => openModal('accept', app)}
                    data-testid="accept-button"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="submit understated"
                    onClick={() => openModal('reject', app)}
                    data-testid="reject-button"
                  >
                    Reject
                  </button>
                </div>
              )}
            </article>
          ))}
        </section>
      )}

      {modal && (
        <div className="manage-modal-backdrop" onClick={closeModal}>
          <div
            className="manage-modal"
            role="dialog"
            aria-modal="true"
            data-testid="decide-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>
              {modal.decision === 'accept' ? 'Accept' : 'Decline'} {modal.application.name}
            </h3>
            <p>
              {modal.decision === 'accept'
                ? `A Stripe checkout link for the £50 CURE subscription will be emailed to ${modal.application.email}.`
                : `A short, respectful note will be emailed to ${modal.application.email}. The Arty Club stays open to them.`}
            </p>
            <div className="form" style={{ marginBottom: 20 }}>
              <div className="row">
                <label htmlFor="decide-notes">Internal notes (optional)</label>
                <textarea
                  id="decide-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  data-testid="decide-notes"
                  placeholder="Not sent to the applicant — for the record only."
                />
              </div>
            </div>
            {decideError && (
              <p className="error" role="alert" data-testid="decide-error">{decideError}</p>
            )}
            <div className="manage-modal-actions">
              <button
                type="button"
                className="submit understated"
                onClick={closeModal}
                disabled={deciding}
                data-testid="decide-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                className={modal.decision === 'accept' ? 'submit' : 'submit understated'}
                onClick={submitDecision}
                disabled={deciding}
                data-testid="decide-confirm"
              >
                {deciding
                  ? 'Sending…'
                  : modal.decision === 'accept'
                    ? 'Send checkout link'
                    : 'Send rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ─── Mount ──────────────────────────────────────────────────────
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <ApplicationsPage />
    </React.StrictMode>,
  );
}
