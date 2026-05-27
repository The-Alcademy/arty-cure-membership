// ─────────────────────────────────────────────────────────────────
// src/pages/me.tsx
//
// Member pass page. Reads ?token=... from the URL, fetches member
// data from /api/membership/me, renders the pass.
//
// Designed to be saved to the home screen as a PWA. Even installed,
// the bookmarked URL retains the token, so the same magic-link auth
// pattern works on every visit.
// ─────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { deriveTier, isActive } from './../lib/deriveTier';

type MemberData = {
  member_number: string;
  name:          string;
  email:         string;
  arty_active:   boolean;
  cure_active:   boolean;
  qr_data_url:   string;
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; member: MemberData; token: string };

// ─── Styles ─────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight:       '100vh',
    background:      '#F5F5F5',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    padding:         '24px 16px',
    boxSizing:       'border-box',
    fontFamily:      'Georgia, "Times New Roman", serif',
  },
  card: {
    width:           '100%',
    maxWidth:        '400px',
    background:      '#FFFFFF',
    borderRadius:    '8px',
    boxShadow:       '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.08)',
    padding:         '32px 28px',
    boxSizing:       'border-box',
  },
  wordmark: {
    fontSize:        '13px',
    fontWeight:      600,
    letterSpacing:   '0.28em',
    color:           '#9A3A26',
    textAlign:       'center',
    marginBottom:    '28px',
    textTransform:   'uppercase',
  },
  name: {
    fontSize:        '28px',
    lineHeight:      1.2,
    color:           '#1A1614',
    margin:          '0 0 6px',
    fontWeight:      500,
  },
  memberNumber: {
    fontSize:        '15px',
    fontFamily:      'ui-monospace, Consolas, "Courier New", monospace',
    color:           '#8A7E72',
    margin:          '0 0 20px',
    letterSpacing:   '0.04em',
  },
  badges: {
    display:         'flex',
    gap:             '8px',
    flexWrap:        'wrap',
    marginBottom:    '28px',
  },
  badge: {
    display:         'inline-block',
    padding:         '5px 12px',
    borderRadius:    '999px',
    fontSize:        '11px',
    fontWeight:      600,
    letterSpacing:   '0.12em',
    fontFamily:      'Arial, sans-serif',
  },
  qrWrap: {
    background:      '#FFFFFF',
    border:          '1px solid #9A3A26',
    borderRadius:    '4px',
    padding:         '12px',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    margin:          '0 auto 16px',
    width:           '224px',
    height:          '224px',
    boxSizing:       'border-box',
  },
  qrImg: {
    width:           '200px',
    height:          '200px',
    display:         'block',
  },
  caption: {
    fontSize:        '13px',
    color:           '#8A7E72',
    textAlign:       'center',
    margin:          '0 0 4px',
    fontStyle:       'italic',
  },
  footer: {
    marginTop:       '28px',
    paddingTop:      '18px',
    borderTop:       '1px solid #E8E4DE',
    fontSize:        '11px',
    color:           '#8A7E72',
    textAlign:       'center',
    letterSpacing:   '0.04em',
  },
  manageLink: {
    color:           '#9A3A26',
    textDecoration:  'none',
    fontWeight:      600,
  },
  loading: {
    color:           '#8A7E72',
    fontSize:        '15px',
    textAlign:       'center',
  },
  errorBox: {
    color:           '#9A3A26',
    fontSize:        '15px',
    textAlign:       'center',
    padding:         '24px 0',
    lineHeight:      1.6,
  },
};

// ─── Page component ─────────────────────────────────────────────
function MePage(): React.ReactElement {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) {
      setState({ kind: 'error', message: 'This link is missing its token. Please open your pass from the link in your welcome email.' });
      return;
    }

    fetch('/api/membership/me?token=' + encodeURIComponent(token))
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 401) {
            setState({ kind: 'error', message: 'This pass link is no longer valid. Please open the link from your most recent welcome email.' });
          } else if (res.status === 404) {
            setState({ kind: 'error', message: 'This membership is no longer on our records. If this is a mistake, please contact members@theartyst.co.uk.' });
          } else {
            setState({ kind: 'error', message: 'We could not load your pass right now. Please try again in a moment.' });
          }
          return;
        }
        setState({ kind: 'ready', member: body as MemberData, token });
      })
      .catch(() => {
        setState({ kind: 'error', message: 'Could not reach the server. Check your connection and try again.' });
      });
  }, []);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.wordmark}>The Artyst · Membership</div>

        {state.kind === 'loading' && (
          <div style={styles.loading}>Loading your pass…</div>
        )}

        {state.kind === 'error' && (
          <div style={styles.errorBox}>{state.message}</div>
        )}

        {state.kind === 'ready' && (() => {
          const m = state.member;
          const tier = deriveTier(m);
          const active = isActive(m);
          return (
            <>
              <h1 style={styles.name}>{m.name}</h1>
              <div style={styles.memberNumber}>{m.member_number}</div>

              <div style={styles.badges}>
                <span style={{ ...styles.badge, background: tier.bg, color: tier.fg }}>
                  {tier.label}
                </span>
                <span style={{
                  ...styles.badge,
                  background: active ? '#1F7A3A' : '#888888',
                  color:      '#FFFFFF',
                }}>
                  {active ? 'ACTIVE' : 'INACTIVE'}
                </span>
              </div>

              <div style={styles.qrWrap}>
                <img src={m.qr_data_url} alt={'QR for ' + m.member_number} style={styles.qrImg} />
              </div>
              <div style={styles.caption}>Show at the bar for member benefits</div>

              <div style={styles.footer}>
                <a
                  href={`/manage?token=${encodeURIComponent(state.token)}`}
                  style={styles.manageLink}
                >
                  Manage subscription
                </a>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}

// ─── Mount ──────────────────────────────────────────────────────
// Register the service worker for offline pass display.
// Best-effort — failure to register doesn't affect the page render.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
 
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <MePage />
    </React.StrictMode>,
  );
}
