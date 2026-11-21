// Owner: B (muzair110).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatEnvFile, parseEnvFile } from './env-file';

// Feature: b-t04-cdk-skeleton, Property 10: Env file round trip
// **Validates: Requirements 9.4, 9.7**
describe('Property 10: Env file round trip', () => {
  const name = fc
    .stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,20}$/)
    .filter((n) => n !== '__proto__');
  // Single-line values, including '=', leading/trailing spaces and the empty string.
  const value = fc.string({ unit: 'binary', maxLength: 40 }).filter((v) => !/[\r\n]/.test(v));
  const outputs = fc.dictionary(name, value, { maxKeys: 10 });

  it('parse(format(m)) equals m with one line per entry', () => {
    fc.assert(
      fc.property(outputs, (m) => {
        const text = formatEnvFile(m);
        expect(parseEnvFile(text)).toEqual(m);
        const lines = text === '' ? [] : text.slice(0, -1).split('\n');
        expect(lines).toHaveLength(Object.keys(m).length);
      }),
      { numRuns: 200 },
    );
  });

  it('round-trips values with "=" and surrounding spaces', () => {
    const m = { A: ' a=b= ', B: '', C: '=' };
    expect(parseEnvFile(formatEnvFile(m))).toEqual(m);
  });

  it('formats an empty map as an empty string', () => {
    expect(formatEnvFile({})).toBe('');
  });
});
