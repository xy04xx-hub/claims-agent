import { describe, expect, it } from 'vitest';
import fixture from '../test/jwt-claims.fixture.json' with { type: 'json' };
import { readCaller } from './caller.js';

const base = (): Record<string, unknown> => ({ ...fixture });

describe('readCaller', () => {
  it('reads the caller from the fixture', () => {
    expect(readCaller(base())).toEqual({
      ok: true,
      caller: { sub: fixture.sub, group: 'Customer', tenantId: fixture.tenantId },
    });
  });

  it('accepts an Adjuster', () => {
    const r = readCaller({ ...base(), 'cognito:groups': ['Adjuster'] });
    expect(r.ok && r.caller.group).toBe('Adjuster');
  });

  const cases: [string, unknown, number, string][] = [
    ['claims absent', undefined, 401, 'UNAUTHORIZED'],
    ['claims not an object', 'x', 401, 'UNAUTHORIZED'],
    ['claims an array', [], 401, 'UNAUTHORIZED'],
    ['id token', { ...base(), token_use: 'id' }, 401, 'UNAUTHORIZED'],
    ['token_use missing', { ...base(), token_use: undefined }, 401, 'UNAUTHORIZED'],
    ['sub missing', { ...base(), sub: undefined }, 403, 'FORBIDDEN'],
    ['sub empty', { ...base(), sub: '' }, 403, 'FORBIDDEN'],
    ['sub too long', { ...base(), sub: 'a'.repeat(129) }, 403, 'FORBIDDEN'],
    ['sub not a string', { ...base(), sub: 5 }, 403, 'FORBIDDEN'],
    ['tenant missing', { ...base(), tenantId: undefined }, 403, 'FORBIDDEN'],
    ['tenant invalid', { ...base(), tenantId: '-bad tenant' }, 403, 'FORBIDDEN'],
    ['groups missing', { ...base(), 'cognito:groups': undefined }, 403, 'FORBIDDEN'],
    ['groups unrecognized', { ...base(), 'cognito:groups': '[customer]' }, 403, 'FORBIDDEN'],
    ['groups wrong type', { ...base(), 'cognito:groups': 7 }, 403, 'FORBIDDEN'],
    ['both groups', { ...base(), 'cognito:groups': '[Customer Adjuster]' }, 403, 'FORBIDDEN'],
  ];

  it.each(cases)('rejects: %s', (_name, claims, status, code) => {
    const r = readCaller(claims);
    expect(r).toMatchObject({ ok: false, status, code });
  });

  it('never puts claim values in the message', () => {
    const claims = { ...base(), sub: 'secret-sub-value', tenantId: 'secret tenant!', 'cognito:groups': '[Weird]' };
    const r = readCaller(claims);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      for (const v of ['secret-sub-value', 'secret tenant', 'Weird']) expect(r.message).not.toContain(v);
    }
  });
});
