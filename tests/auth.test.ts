import { describe, expect, it } from 'vitest';
import { createSession, verifySession } from '../src/server/auth.js';

describe('session signing', () => {
  it('accepts a valid signed session', () => {
    expect(verifySession(createSession())).toBe(true);
  });

  it('rejects a modified session', () => {
    const token=createSession();
    expect(verifySession(token.slice(0,-1)+(token.endsWith('a')?'b':'a'))).toBe(false);
  });
});
