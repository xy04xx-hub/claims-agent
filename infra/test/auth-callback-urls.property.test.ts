// Owner: B (muzair110)
// Feature: b-t06-auth-stack, Property 6
// **Validates: Requirements 7.5, 7.9, 7.10, 7.11**
import * as cdk from 'aws-cdk-lib';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CALLBACK_PATH } from '../lib/constructs/platform/auth-model.js';
import { buildAppClientUrls } from '../lib/constructs/platform/app-client-urls.js';
import { hostArb, localOriginsArb } from './helpers/origins.js';

const RUNS = { numRuns: 100 };

const consoleUrlArb = hostArb.map((h) => `https://${h}`);

/** A local list that may repeat entries, so duplicate removal is exercised. */
const localsWithDuplicatesArb = localOriginsArb.chain((list) =>
  list.length === 0
    ? fc.constant(list)
    : fc.constantFrom(...list).map((dup) => [...list, dup]),
);

describe('buildAppClientUrls (Property 6)', () => {
  it('puts the console callback first, then local callbacks, with no duplicates', () => {
    fc.assert(
      fc.property(consoleUrlArb, localsWithDuplicatesArb, (consoleUrl, locals) => {
        const { callbackUrls, logoutUrls } = buildAppClientUrls(consoleUrl, locals);
        const expected = [
          ...new Set([consoleUrl, ...locals].map((o) => `${o}${CALLBACK_PATH}`)),
        ];
        expect(callbackUrls).toEqual(expected);
        expect(callbackUrls[0]).toBe(`${consoleUrl}/`);
        expect(new Set(callbackUrls).size).toBe(callbackUrls.length);
        expect(callbackUrls.every((u) => u.endsWith('/'))).toBe(true);
        expect(logoutUrls).toEqual(callbackUrls);
        expect(logoutUrls).not.toBe(callbackUrls);
      }),
      RUNS,
    );
  });

  it('rejects a console URL that is not https', () => {
    fc.assert(
      fc.property(hostArb, localOriginsArb, (host, locals) => {
        expect(() => buildAppClientUrls(`http://${host}`, locals)).toThrow(/https/);
      }),
      RUNS,
    );
  });

  it('rejects a console URL with a trailing slash or a path', () => {
    fc.assert(
      fc.property(
        hostArb,
        fc.constantFrom('/', '/app', '/?x=1', '#f'),
        localOriginsArb,
        (host, suffix, locals) => {
          expect(() => buildAppClientUrls(`https://${host}${suffix}`, locals)).toThrow(
            /no path|trailing/,
          );
        },
      ),
      RUNS,
    );
  });

  it('rejects an https local origin and names it', () => {
    fc.assert(
      fc.property(consoleUrlArb, hostArb, (consoleUrl, host) => {
        const bad = `https://${host}`;
        expect(() => buildAppClientUrls(consoleUrl, [bad])).toThrow(bad);
      }),
      RUNS,
    );
  });

  it('accepts an unresolved token console URL', () => {
    const url = cdk.Fn.join('', ['https://', cdk.Lazy.string({ produce: () => 'x' })]);
    expect(cdk.Token.isUnresolved(url)).toBe(true);
    const out = buildAppClientUrls(url, ['http://localhost:5173']);
    expect(out.callbackUrls).toEqual([`${url}/`, 'http://localhost:5173/']);
    expect(out.logoutUrls).toEqual(out.callbackUrls);
  });
});
