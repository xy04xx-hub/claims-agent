import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CI_PLACEHOLDER_ACCOUNT, resolveAccount } from '../lib/stage.js';

// Feature: b-t04-cdk-skeleton, Property 3: Account resolution
// **Validates: Requirements 2.4, 2.10**

const stageArb = fc.oneof(
  fc.constant('ci'),
  fc.constantFrom('dev-a', 'dev-b', 'demo'),
  fc.stringMatching(/^[a-z][a-z0-9-]{0,31}$/),
);

const setAccountArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim() !== '');

const blankArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc.stringMatching(/^[ \t\n\r]{1,6}$/),
);

const otherEnvArb = fc.dictionary(
  fc.stringMatching(/^[A-Z_]{1,12}$/).filter((k) => k !== 'CDK_DEFAULT_ACCOUNT'),
  fc.string({ maxLength: 20 }),
);

describe('Property 3: account resolution', () => {
  it('returns CDK_DEFAULT_ACCOUNT when set and non-blank', () => {
    fc.assert(
      fc.property(stageArb, setAccountArb, otherEnvArb, (stage, account, other) => {
        expect(resolveAccount(stage, { ...other, CDK_DEFAULT_ACCOUNT: account })).toBe(account);
      }),
      { numRuns: 100 },
    );
  });

  it('returns the placeholder for stage ci when the account is unset or blank', () => {
    fc.assert(
      fc.property(blankArb, otherEnvArb, (blank, other) => {
        const env = { ...other, CDK_DEFAULT_ACCOUNT: blank };
        expect(resolveAccount('ci', env)).toBe(CI_PLACEHOLDER_ACCOUNT);
      }),
      { numRuns: 100 },
    );
  });

  it('throws an error naming CDK_DEFAULT_ACCOUNT for any other stage when unset or blank', () => {
    fc.assert(
      fc.property(
        stageArb.filter((s) => s !== 'ci'),
        blankArb,
        otherEnvArb,
        (stage, blank, other) => {
          const env = { ...other, CDK_DEFAULT_ACCOUNT: blank };
          expect(() => resolveAccount(stage, env)).toThrow(/CDK_DEFAULT_ACCOUNT/);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('placeholder is never a real-looking 12-digit value unless it is the computed fallback', () => {
    const fallback = '0'.repeat(12);
    if (/^\d{12}$/.test(CI_PLACEHOLDER_ACCOUNT)) {
      expect(CI_PLACEHOLDER_ACCOUNT).toBe(fallback);
    } else {
      expect(CI_PLACEHOLDER_ACCOUNT).not.toMatch(/\d{12}/);
    }
    fc.assert(
      fc.property(blankArb, (blank) => {
        const result = resolveAccount('ci', { CDK_DEFAULT_ACCOUNT: blank });
        expect(/^\d{12}$/.test(result) ? result === fallback : true).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
