// Feature: b-t04-cdk-skeleton, Property 8: Suppression reasons need at least 10 characters
// **Validates: Requirements 6.4**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isValidSuppressionReason } from '../lib/nag.js';

describe('Property 8: suppression reason validity', () => {
  it('is true iff the value is a string whose trimmed length is at least 10', () => {
    const anyValue = fc.oneof(
      fc.string({ maxLength: 30 }),
      fc.string({ unit: 'binary', maxLength: 30 }),
      fc.tuple(fc.constantFrom('', ' ', '\t', '\n', '  '), fc.string({ maxLength: 15 }), fc.constantFrom('', ' ', '\n', '   '))
        .map(([a, b, c]) => a + b + c),
      fc.constant(undefined),
      fc.constant(null),
      fc.integer(),
      fc.boolean(),
      fc.array(fc.string()),
      fc.object(),
    );
    fc.assert(
      fc.property(anyValue, (r) => {
        const expected = typeof r === 'string' && r.trim().length >= 10;
        expect(isValidSuppressionReason(r)).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });
});
