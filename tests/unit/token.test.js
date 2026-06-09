'use strict';

process.env.JWT_ACCESS_SECRET = 'unit_access';
process.env.JWT_REFRESH_SECRET = 'unit_refresh';

const {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} = require('../../src/utils/token');

describe('token utils', () => {
  it('signs and verifies an access token round-trip', () => {
    const token = signAccessToken({ sub: 42, role: 'counselor' });
    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe(42);
    expect(decoded.role).toBe('counselor');
  });

  it('rejects an access token verified with the refresh secret', () => {
    const token = signAccessToken({ sub: 1 });
    expect(() => verifyRefreshToken(token)).toThrow();
  });

  it('signs and verifies a refresh token', () => {
    const token = signRefreshToken({ sub: 7 });
    expect(verifyRefreshToken(token).sub).toBe(7);
  });

  it('produces a stable, non-reversible hash', () => {
    const h1 = hashToken('abc');
    const h2 = hashToken('abc');
    expect(h1).toBe(h2);
    expect(h1).not.toContain('abc');
    expect(h1).toHaveLength(64);
  });
});
