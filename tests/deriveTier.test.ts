import { describe, it, expect } from 'vitest';
import { deriveTier, isActive } from '../src/lib/deriveTier';

describe('deriveTier', () => {
  it('shows CURE CLUB when cure_active is true, regardless of arty_active', () => {
    expect(deriveTier({ arty_active: false, cure_active: true })).toEqual({
      label: 'CURE CLUB',
      bg:    '#5A1A0E',
      fg:    '#FFFFFF',
    });
    // CURE wins even when both are active — there is no BOTH CLUBS tier.
    expect(deriveTier({ arty_active: true, cure_active: true })).toEqual({
      label: 'CURE CLUB',
      bg:    '#5A1A0E',
      fg:    '#FFFFFF',
    });
  });

  it('shows ARTY CLUB when only arty_active', () => {
    expect(deriveTier({ arty_active: true, cure_active: false })).toEqual({
      label: 'ARTY CLUB',
      bg:    '#9A3A26',
      fg:    '#FFFFFF',
    });
  });

  it('shows CANCELLED when neither is active', () => {
    expect(deriveTier({ arty_active: false, cure_active: false })).toEqual({
      label: 'CANCELLED',
      bg:    '#888888',
      fg:    '#FFFFFF',
    });
  });
});

describe('isActive', () => {
  it('returns true when either flag is set', () => {
    expect(isActive({ arty_active: true,  cure_active: false })).toBe(true);
    expect(isActive({ arty_active: false, cure_active: true  })).toBe(true);
    expect(isActive({ arty_active: true,  cure_active: true  })).toBe(true);
  });

  it('returns false when both are off', () => {
    expect(isActive({ arty_active: false, cure_active: false })).toBe(false);
  });
});
