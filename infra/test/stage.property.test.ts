import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseStage } from '../lib/stage.js';

const ALLOWED = /^[a-z][a-z0-9-]{0,31}$/;

function expectRejected(input: unknown): void {
  let message = '';
  try {
    parseStage(input);
  } catch (e) {
    message = (e as Error).message;
  }
  expect(message).toContain('stage');
  expect(message).toContain('lowercase letters, digits and hyphens');
  expect(message).toContain('1 to 32 characters');
}

// Feature: b-t04-cdk-skeleton, Property 1: Stage validation accepts exactly the allowed format
// Validates: Requirements 2.2, 2.9
describe('Property 1: stage validation accepts exactly the allowed format', () => {
  const validStage = fc
    .tuple(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
      fc.stringMatching(/^[a-z0-9-]{0,31}$/),
    )
    .map(([head, tail]) => head + tail);

  it('returns the input unchanged for every valid stage', () => {
    fc.assert(
      fc.property(validStage, (s) => {
        expect(parseStage(s)).toBe(s);
      }),
      { numRuns: 200 },
    );
  });

  it('for any string, accepts iff it matches the allowed format', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string({ unit: 'binary' })), (s) => {
        if (ALLOWED.test(s)) {
          expect(parseStage(s)).toBe(s);
        } else {
          expectRejected(s);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('rejects strings longer than 32 characters', () => {
    fc.assert(
      fc.property(validStage, fc.stringMatching(/^[a-z0-9-]{1,20}$/), (s, extra) => {
        expectRejected((s + 'a'.repeat(32) + extra).slice(0, 33 + extra.length));
      }),
      { numRuns: 100 },
    );
  });

  it('rejects uppercase, leading digit or hyphen, whitespace and empty', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          validStage.map((s) => 'A' + s),
          validStage.map((s) => '1' + s),
          validStage.map((s) => '-' + s),
          fc.stringMatching(/^\s{1,10}$/),
          fc.constant(''),
        ),
        (s) => expectRejected(s),
      ),
      { numRuns: 100 },
    );
  });

  it('rejects non-string values', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
          fc.array(fc.string()),
          fc.object(),
        ),
        (v) => expectRejected(v),
      ),
      { numRuns: 100 },
    );
  });
});
