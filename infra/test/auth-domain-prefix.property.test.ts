// Owner: B (muzair110)
// Feature: b-t06-auth-stack, Property 4
// **Validates: Requirements 6.3, 6.4, 6.5, 6.6**
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cognitoDomainPrefix, RESERVED_DOMAIN_WORDS } from '../lib/constructs/platform/cognito-domain';
import { STAGE_PATTERN } from '../lib/stage';

const RUNS = { numRuns: 100 };
const COGNITO_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const hasReserved = (s: string): boolean => RESERVED_DOMAIN_WORDS.some((w) => s.includes(w));

const plainStageArb = fc.stringMatching(STAGE_PATTERN).filter((s) => !hasReserved(s));

// Reserved word inserted at the start, in the middle or at the end of a valid stage.
const reservedStageArb = fc
  .tuple(
    fc.constantFrom(...RESERVED_DOMAIN_WORDS),
    fc.stringMatching(/^[a-z0-9-]{0,8}$/),
    fc.stringMatching(/^[a-z0-9-]{0,8}$/),
    fc.constantFrom('x', ''),
  )
  .map(([word, pre, post, lead]) => `${pre === '' ? lead : 'x'}${pre}${word}${post}`)
  .filter((s) => STAGE_PATTERN.test(s) && hasReserved(s));

const accountArb = fc.oneof(fc.stringMatching(/^[0-9]{12}$/), fc.constant('ci-placeholder'));
const regionArb = fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1');

describe('cognitoDomainPrefix (Property 4)', () => {
  it('is valid, stable, starts with claims-<stage>- and has no reserved word', () => {
    fc.assert(
      fc.property(plainStageArb, accountArb, regionArb, (stage, account, region) => {
        const p = cognitoDomainPrefix(stage, account, region);
        expect(p).toMatch(COGNITO_PATTERN);
        expect(p.length).toBeLessThanOrEqual(63);
        expect(p.startsWith(`claims-${stage}-`)).toBe(true);
        expect(hasReserved(p)).toBe(false);
        expect(cognitoDomainPrefix(stage, account, region)).toBe(p);
      }),
      RUNS,
    );
  });

  it('differs for two different accounts with the same stage and region', () => {
    fc.assert(
      fc.property(plainStageArb, accountArb, accountArb, regionArb, (stage, a, b, region) => {
        fc.pre(a !== b);
        expect(cognitoDomainPrefix(stage, a, region)).not.toBe(cognitoDomainPrefix(stage, b, region));
      }),
      RUNS,
    );
  });

  it('throws an error naming the stage when the stage has a reserved word', () => {
    fc.assert(
      fc.property(reservedStageArb, accountArb, regionArb, (stage, account, region) => {
        expect(() => cognitoDomainPrefix(stage, account, region)).toThrow(stage);
      }),
      RUNS,
    );
  });

  it.each(['dev-b', 'demo'])('gives the form claims-%s-xxxxxxxx', (stage) => {
    expect(cognitoDomainPrefix(stage, '111122223333', 'us-east-1')).toMatch(
      new RegExp(`^claims-${stage}-[0-9a-f]{8}$`),
    );
  });
});
