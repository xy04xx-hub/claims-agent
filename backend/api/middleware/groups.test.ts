import { describe, expect, it } from 'vitest';
import fixture from '../test/jwt-claims.fixture.json' with { type: 'json' };
import { parseGroups } from './groups.js';

describe('parseGroups', () => {
  it.each([
    ['[Customer]', ['Customer']],
    ['[Customer Adjuster]', ['Customer', 'Adjuster']],
    ['["Customer"]', ['Customer']],
    ['["Customer","Adjuster"]', ['Customer', 'Adjuster']],
    ['Customer', ['Customer']],
    ['', []],
    ['   ', []],
    ['[]', []],
    ['["a" "b"]', ['a', 'b']],
    [['Customer', ' Adjuster ', '', 3], ['Customer', 'Adjuster']],
    [42, []],
    [null, []],
    [undefined, []],
    [{ a: 1 }, []],
    [[[['Customer']]], []],
  ])('parses %j', (input, expected) => {
    expect(parseGroups(input)).toEqual(expected);
  });

  it('parses the claims fixture', () => {
    expect(parseGroups(fixture['cognito:groups'])).toEqual(['Customer']);
  });
});
