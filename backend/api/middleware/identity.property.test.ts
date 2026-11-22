import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ROUTES, type Group, type HandlerRoute } from '../routes.js';
import {
  JSON_HEADERS,
  fixedClock,
  makeEvent,
  makeRecorder,
  validBodyFor,
  validPathParametersFor,
} from '../test/helpers.js';
import { handleRequest } from './middleware.js';
import type { Caller, RouteContext } from './types.js';

const RUNS = { numRuns: 100 };

const sub = fc.string({ minLength: 1, maxLength: 128 });
const tenantId = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/);
const keyName = fc.constantFrom('tenantId', 'role', 'group', 'customerId', 'sub', 'x-tenant-id');
const noiseValue = fc.string({ maxLength: 40 });

// Feature: b-t08-api-stack, Property 3: Caller identity comes only from the verified claims
// Validates: Requirements 5.1, 5.10, 6.12
describe('Property 3: caller identity comes only from the verified claims', () => {
  it('passes the handler the caller built from the claims, whatever else the request carries', async () => {
    const scenario = fc.record({
      route: fc.constantFrom(...ROUTES),
      pick: fc.nat(),
      sub,
      tenantId,
      extraClaims: fc.dictionary(fc.constantFrom('custom:role', 'custom:customerId', 'email', 'scope'), noiseValue),
      headerNoise: fc.dictionary(keyName, noiseValue),
      queryNoise: fc.dictionary(keyName, noiseValue),
      pathNoise: fc.dictionary(keyName, noiseValue),
      eventNoise: fc.dictionary(keyName, noiseValue),
      arrayGroups: fc.boolean(),
    });

    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const route: HandlerRoute = s.route;
        const group: Group = route.groups[s.pick % route.groups.length]!;
        const calls: Array<{ ctx: RouteContext }> = [];
        const handlers = {
          [route.routeKey]: async (ctx: RouteContext) => {
            calls.push({ ctx });
            return { statusCode: 200, body: { ok: true } };
          },
        };

        const claims = {
          ...s.extraClaims,
          sub: s.sub,
          tenantId: s.tenantId,
          token_use: 'access',
          'cognito:groups': s.arrayGroups ? [group] : `[${group}]`,
        };
        const body = validBodyFor(route);
        const base = makeEvent({
          routeKey: route.routeKey,
          claims,
          ...(body !== undefined ? { body } : {}),
          headers: { ...JSON_HEADERS, ...s.headerNoise },
          pathParameters: { ...s.pathNoise, ...validPathParametersFor(route) },
        });
        const event = {
          ...s.eventNoise,
          ...base,
          queryStringParameters: s.queryNoise,
          rawQueryString: new URLSearchParams(s.queryNoise).toString(),
        };

        const rec = makeRecorder();
        const res = await handleRequest(event, {
          service: route.function,
          log: rec.log,
          metrics: rec.metrics,
          now: fixedClock(),
          handlers,
        });

        expect(res.statusCode).toBe(200);
        expect(calls).toHaveLength(1);
        const expected: Caller = { sub: s.sub, group, tenantId: s.tenantId };
        expect(calls[0]!.ctx.caller).toEqual(expected);
      }),
      RUNS,
    );
  });
});
