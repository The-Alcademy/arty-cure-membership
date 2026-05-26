// ───────────────────────────────────────────────────────────────── 
// src/lib/memberToken.ts
//
// HMAC-signed magic-link tokens for member pass URLs.
//
// Usage:
//   const token = signToken(memberId);
//   // ...later, from /me?token=...
//   const memberId = verifyToken(token);
//   if (!memberId) return invalidLinkPage();
//
// Token format: base64url(payload) + '.' + base64url(signature)
// Payload is JSON: { mid: string, iat: number }
// Signature is HMAC-SHA256 of the payload using MEMBER_TOKEN_SECRET.
//
// Tokens do not expire by design — members bookmark their link.
// If we ever need to revoke, we rotate MEMBER_TOKEN_SECRET (invalidates all).
// ─────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from 'node:crypto';

function getSecret(): string {
  const secret = process.env.MEMBER_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'MEMBER_TOKEN_SECRET is missing or too short (need >= 32 chars). ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return secret;
}

function base64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(s: string): Buffer {
  // Add padding back
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

export function signToken(memberId: string): string {
  if (!memberId) throw new Error('memberId is required');
  const payload = JSON.stringify({ mid: memberId, iat: Date.now() });
  const payloadEncoded = base64urlEncode(payload);
  const sig = createHmac('sha256', getSecret()).update(payloadEncoded).digest();
  const sigEncoded = base64urlEncode(sig);
  return `${payloadEncoded}.${sigEncoded}`;
}

export function verifyToken(token: string | undefined | null): string | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadEncoded, sigEncoded] = parts;

  // Recompute signature
  let expectedSig: Buffer;
  try {
    expectedSig = createHmac('sha256', getSecret()).update(payloadEncoded).digest();
  } catch {
    return null;
  }

  // Decode provided signature
  let providedSig: Buffer;
  try {
    providedSig = base64urlDecode(sigEncoded);
  } catch {
    return null;
  }

  if (providedSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(providedSig, expectedSig)) return null;

  // Signature valid — decode payload
  try {
    const payload = JSON.parse(base64urlDecode(payloadEncoded).toString('utf8'));
    if (typeof payload?.mid !== 'string' || !payload.mid) return null;
    return payload.mid;
  } catch {
    return null;
  }
}
