import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import fixture from '../test/jwt-claims.fixture.json' with { type: 'json' };
import { readCaller } from './caller.js';
import { parseGroups } from './groups.js';

const RUNS = { numRuns: 100 };

const baseClaims = {
  sub: 'user-1',
  tenantId: 'demo-tenant',
  token_use: 'access',
} as const;

const name = fc.constantFrom('Customer', 'Adjuster', 'customer', 'ADJUSTER', 'Admin', ' Customer', 'x');

// Values likely to hit recognized and near-miss group names, plus arbitrary junk.
const groupsValue: fc.Arbitrary<unknown> = fc.oneof(
  fc.anything(),
  fc.array(fc.oneof(name, fc.anything())),
  fc.array(name).map((names) => `[${names.join(' ')}]`),
  fc.array(name).map((names) => JSON.stringify(names)),
  name,
);

// Feature: b-t08-api-stack, Property 1: The group parser is total and recognizes only exact group names
// Validates: Requirements 5.7, 5.12
describe('Property 1: group parser totality and exact names', () => {
  it('never throws and returns only non-empty strings', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const result = parseGroups(value);
        expect(Array.isArray(result)).toBe(true);
        for (const entry of result) {
          expect(typeof entry).toBe('string');
          expect(entry).not.toBe('');
        }
      }),
      RUNS,
    );
  });

  it('yields a caller only when exactly one of Customer and Adjuster is an exact entry', () => {
    fc.assert(
      fc.property(groupsValue, (value) => {
        const parsed = parseGroups(value);
        const recognized = new Set(parsed.filter((g) => g === 'Customer' || g === 'Adjuster'));
        const result = readCaller({ ...baseClaims, 'cognito:groups': value });
        if (recognized.size === 1) {
          expect(result.ok).toBe(true);
          if (result.ok) expect(result.caller.group).toBe([...recognized][0]);
        } else {
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.status).toBe(403);
        }
      }),
      RUNS,
    );
  });
});

// Feature: b-t08-api-stack, Property 2: Group parsing round trip
// Validates: Requirements 5.6, 5.13
describe('Property 2: group parsing round trip', () => {
  const groupName = fc.stringMatching(/^[^\s[\]"',]+$/);

  it('parses the bracketed string and the array back to the same names', () => {
    fc.assert(
      fc.property(fc.array(groupName, { maxLength: 8 }), (names) => {
        expect(parseGroups(`[${names.join(' ')}]`)).toEqual(names);
        expect(parseGroups(names)).toEqual(names);
      }),
      RUNS,
    );
  });

  it('parses the recorded claims fixture to a single group', () => {
    expect(parseGroups(fixture['cognito:groups'])).toEqual(['Customer']);
  });
});
