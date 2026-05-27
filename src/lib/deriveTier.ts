// Tier derivation for member surfaces (the PWA pass at /me and the manage
// page at /manage).
//
// Rule: CURE includes Arty by definition (May 2026 CURE restructure spec),
// so anyone with cure_active=true is shown as CURE CLUB regardless of
// arty_active. There is no "BOTH CLUBS" tier.

export type MemberFlags = {
  arty_active: boolean;
  cure_active: boolean;
};

export type Tier = {
  label: string;
  bg:    string;
  fg:    string;
};

export function deriveTier(m: MemberFlags): Tier {
  if (m.cure_active) {
    return { label: 'CURE CLUB',  bg: '#5A1A0E', fg: '#FFFFFF' };
  }
  if (m.arty_active) {
    return { label: 'ARTY CLUB',  bg: '#9A3A26', fg: '#FFFFFF' };
  }
  return   { label: 'CANCELLED',  bg: '#888888', fg: '#FFFFFF' };
}

export function isActive(m: MemberFlags): boolean {
  return m.arty_active || m.cure_active;
}
