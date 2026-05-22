import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import benefitsData from '../content/benefits.json';

type ReadyResponse = {
  ready: true;
  name: string;
  member_number: string;
  arty: boolean;
  cure: boolean;
};

type NotReadyResponse = { ready: false };
type PollResponse = ReadyResponse | NotReadyResponse;

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;

function clubLabel(arty: boolean, cure: boolean): string {
  if (arty && cure) return 'Arty Club & CURE Club';
  if (arty) return 'Arty Club';
  return 'CURE Club';
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function readSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('session_id');
}

type Phase =
  | { kind: 'missing_session' }
  | { kind: 'polling' }
  | { kind: 'timeout' }
  | { kind: 'ready'; data: ReadyResponse };

export default function WelcomePage() {
  const sessionId = readSessionId();
  const [phase, setPhase] = useState<Phase>(
    sessionId ? { kind: 'polling' } : { kind: 'missing_session' },
  );
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!sessionId) return;
    cancelledRef.current = false;
    const startedAt = Date.now();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelledRef.current) return;
      try {
        const res = await fetch(
          `/api/membership/by-session?session_id=${encodeURIComponent(sessionId)}`,
        );
        if (cancelledRef.current) return;
        if (res.ok) {
          const body = (await res.json()) as PollResponse;
          if (cancelledRef.current) return;
          if (body.ready) {
            setPhase({ kind: 'ready', data: body });
            return;
          }
        }
      } catch {
        // network error — keep polling until the timeout
      }
      if (cancelledRef.current) return;
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setPhase({ kind: 'timeout' });
        return;
      }
      timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
    };

    timeoutId = setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      cancelledRef.current = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [sessionId]);

  useEffect(() => {
    if (phase.kind !== 'ready') return;
    let cancelled = false;
    QRCode.toDataURL(phase.data.member_number, { width: 220, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [phase]);

  return (
    <main className="page welcome">
      {phase.kind === 'missing_session' && (
        <section className="welcome-status">
          <p>
            This page needs a checkout session id. If you've just paid, you should be
            redirected here automatically — try the link in your confirmation email.
          </p>
        </section>
      )}

      {phase.kind === 'polling' && (
        <section className="welcome-status" data-testid="welcome-polling">
          <p>Welcoming you in...</p>
        </section>
      )}

      {phase.kind === 'timeout' && (
        <section className="welcome-status" data-testid="welcome-timeout">
          <p>
            We're processing your subscription. Check your inbox for confirmation — if
            you don't see it within 5 minutes, contact matthew@othersyde.co.uk.
          </p>
        </section>
      )}

      {phase.kind === 'ready' && (
        <article className="welcome-ready" data-testid="welcome-ready">
          <header className="hero">
            <h1>
              Welcome to the {clubLabel(phase.data.arty, phase.data.cure)},{' '}
              {firstName(phase.data.name)}.
            </h1>
          </header>

          <p className="member-number" data-testid="member-number">
            Your member number is <strong>{phase.data.member_number}</strong>
          </p>

          <div className="qr" data-testid="welcome-qr">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt={`QR code for ${phase.data.member_number}`} />
            ) : (
              <span className="qr-placeholder">Generating QR code…</span>
            )}
          </div>

          <p className="redemption">
            Show this number or QR at the bar for your 10% discount on food and drink.
            Check your email — your welcome message and a link to manage your
            subscription are on the way.
          </p>

          <section className="benefits">
            <h3>What membership gets you</h3>
            <ul>
              {benefitsData.benefits.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </section>
        </article>
      )}
    </main>
  );
}
