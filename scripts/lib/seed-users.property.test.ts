// Owner: B (muzair110).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PASSWORD_POLICY } from '../../infra/lib/constructs/platform/auth-model';
import { generateTemporaryPassword } from './seed-users';

// Characters Cognito accepts as password symbols (subset relevant to the generator, plus the documented set).
const COGNITO_SYMBOLS = '^$*.[]{}()?"!@#%&/\\,><\':;|_~`=+- ';

/** Deterministic random source: cycles through the generated integers, reduced modulo the bound. */
function sourceFrom(ints: number[]): (max: number) => number {
  let i = 0;
  return (max) => {
    const n = ints[i % ints.length]!;
    i += 1;
    return n % max;
  };
}

// Feature: b-t06-auth-stack, Property 7: Generated temporary passwords satisfy the password policy
// **Validates: Requirements 12.6**
describe('Property 7: Generated temporary passwords satisfy the password policy', () => {
  const intsArb = fc.array(fc.nat({ max: 1_000_000 }), { minLength: 1, maxLength: 200 });

  it('meets length, character classes and allowed symbols for any random source', () => {
    fc.assert(
      fc.property(intsArb, (ints) => {
        const pw = generateTemporaryPassword(sourceFrom(ints));
        expect(pw.length).toBeGreaterThanOrEqual(PASSWORD_POLICY.minLength);
        expect(pw).toMatch(/[a-z]/);
        expect(pw).toMatch(/[A-Z]/);
        expect(pw).toMatch(/[0-9]/);
        const symbols = [...pw].filter((c) => !/[a-zA-Z0-9]/.test(c));
        expect(symbols.length).toBeGreaterThan(0);
        for (const c of symbols) expect(COGNITO_SYMBOLS).toContain(c);
        // Safe to paste in a shell and type on the hosted page.
        expect(pw).not.toMatch(/[\s'"`\\$]/);
      }),
      { numRuns: 100 },
    );
  });

  it('is deterministic for the same random source', () => {
    fc.assert(
      fc.property(intsArb, (ints) => {
        expect(generateTemporaryPassword(sourceFrom(ints))).toBe(generateTemporaryPassword(sourceFrom(ints)));
      }),
      { numRuns: 100 },
    );
  });
});
