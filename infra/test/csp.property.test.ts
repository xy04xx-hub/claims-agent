// Owner: B (muzair110)
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildCsp, cspDirectives } from '../lib/constructs/platform/csp.js';
import { cspListsArb } from './helpers/csp-sources.js';

/** Parse a CSP string: split on '; ' into directives, then on spaces into name and sources. */
function parseCsp(csp: string): Array<[string, string[]]> {
  return csp.split('; ').map((d) => {
    const [name, ...sources] = d.split(' ');
    return [name as string, sources];
  });
}

const FIXED_ORDER = [
  'default-src',
  'script-src',
  'style-src',
  'img-src',
  'font-src',
  'connect-src',
  'form-action',
  'frame-ancestors',
  'base-uri',
  'object-src',
];

/** Lists where all three keys share origins, to exercise de-duplication. */
const overlappingListsArb = cspListsArb.chain((l) =>
  fc.constantFrom(
    { ...l, cspCognitoOrigins: [...l.cspApiOrigins, ...l.cspCognitoOrigins].slice(0, 4) },
    { ...l, cspEvidenceOrigins: l.cspApiOrigins },
    { cspApiOrigins: l.cspApiOrigins, cspCognitoOrigins: l.cspApiOrigins, cspEvidenceOrigins: l.cspApiOrigins },
  ),
);

const anyListsArb = fc.oneof(cspListsArb, overlappingListsArb);

describe('buildCsp properties', () => {
  // Feature: b-t07-web-stack, Property 4
  it('Property 4: fixed directives, configured origins and no unsafe keyword', () => {
    fc.assert(
      fc.property(anyListsArb, (l) => {
        const csp = buildCsp(l);
        const parsed = parseCsp(csp);
        expect(parsed.map(([n]) => n)).toEqual(FIXED_ORDER);
        const get = (name: string): string[] => parsed.find(([n]) => n === name)?.[1] ?? [];

        expect(get('default-src')).toEqual(["'none'"]);
        expect(get('script-src')).toEqual(["'self'"]);
        expect(get('style-src')).toEqual(["'self'"]);
        expect(get('font-src')).toEqual(["'self'"]);
        expect(get('frame-ancestors')).toEqual(["'none'"]);
        expect(get('base-uri')).toEqual(["'self'"]);
        expect(get('object-src')).toEqual(["'none'"]);

        const expectedConnect = [
          ...new Set(["'self'", ...l.cspApiOrigins, ...l.cspCognitoOrigins, ...l.cspEvidenceOrigins]),
        ];
        expect(get('connect-src')).toEqual(expectedConnect);
        expect(get('img-src')).toEqual(["'self'", 'data:', ...l.cspEvidenceOrigins]);
        expect(get('form-action')).toEqual(["'self'", ...l.cspEvidenceOrigins]);

        for (const bad of ["'unsafe-inline'", "'unsafe-eval'", 'blob:', 'http:']) {
          expect(csp).not.toContain(bad);
        }
        for (const [, sources] of parsed) {
          expect(sources).not.toContain('*');
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: b-t07-web-stack, Property 5
  it('Property 5: parsing the header returns the directive list', () => {
    fc.assert(
      fc.property(anyListsArb, (l) => {
        expect(parseCsp(buildCsp(l))).toEqual(cspDirectives(l).map(([n, s]) => [n, [...s]]));
      }),
      { numRuns: 100 },
    );
  });
});
