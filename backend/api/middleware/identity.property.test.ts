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

// Feature: b-t08-api-stack, Property 4: Identity defects are rejected before the route runs
// Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.7, 5.8, 5.11
describe('Property 4: identity defects are rejected before the route runs', () => {
  type Defect =
    | { kind: 'absent'; claims: undefined | null | string | number | unknown[] }
    | { kind: 'token'; tokenUse: unknown }
    | { kind: 'sub'; sub: unknown }
    | { kind: 'tenant'; tenantId: unknown }
    | { kind: 'groups'; groups: unknown };

  const marker = fc.stringMatching(/^[a-z0-9]{12}$/);

  const defectFor = (m: string): fc.Arbitrary<Defect> =>
    fc.oneof(
      fc.constantFrom<Defect>(
        { kind: 'absent', claims: undefined },
        { kind: 'absent', claims: null },
        { kind: 'absent', claims: `str-${m}` },
        { kind: 'absent', claims: 42 },
        { kind: 'absent', claims: [m] },
      ),
      fc.constantFrom<unknown>(undefined, null, 'id', 'ID', 'Access', '', 7, `use-${m}`).map(
        (tokenUse): Defect => ({ kind: 'token', tokenUse }),
      ),
      fc.constantFrom<unknown>(undefined, null, '', 5, `${m}${'x'.repeat(130)}`).map(
        (v): Defect => ({ kind: 'sub', sub: v }),
      ),
      fc.constantFrom<unknown>(undefined, null, '', 9, `-${m}`, `has space ${m}`, `${m}!`, `${'a'.repeat(41)}${m}`).map(
        (v): Defect => ({ kind: 'tenant', tenantId: v }),
      ),
      fc.constantFrom<unknown>(
        undefined,
        null,
        '',
        '[]',
        `[customer ${m}]`,
        `[Admin${m}]`,
        '[Customer Adjuster]',
        ['Customer', 'Adjuster'],
        [`Other${m}`],
        [],
        7,
      ).map((v): Defect => ({ kind: 'groups', groups: v })),
    );

  it('answers 401 or 403 with the generic message, runs no handler and does not validate the body', async () => {
    const scenario = fc.record({
      route: fc.constantFrom(...ROUTES),
      pick: fc.nat(),
      m: marker,
    });

    await fc.assert(
      fc.asyncProperty(
        scenario.chain((s) => defectFor(s.m).map((defect) => ({ ...s, defect }))),
        async (s) => {
          const route: HandlerRoute = s.route;
          const group: Group = route.groups[s.pick % route.groups.length]!;
          let handlerCalls = 0;
          const handlers = {
            [route.routeKey]: async () => {
              handlerCalls += 1;
              return { statusCode: 200, body: { ok: true } };
            },
          };

          const claims: Record<string, unknown> = {
            sub: `sub-${s.m}`,
            tenantId: 'demo-tenant',
            token_use: 'access',
            'cognito:groups': `[${group}]`,
          };
          let eventClaims: unknown = claims;
          let expectedStatus: 401 | 403 = 403;
          let expectedCode: 'UNAUTHORIZED' | 'FORBIDDEN' = 'FORBIDDEN';
          const d = s.defect;
          switch (d.kind) {
            case 'absent':
              eventClaims = d.claims;
              expectedStatus = 401;
              expectedCode = 'UNAUTHORIZED';
              break;
            case 'token':
              claims['token_use'] = d.tokenUse;
              expectedStatus = 401;
              expectedCode = 'UNAUTHORIZED';
              break;
            case 'sub':
              claims['sub'] = d.sub;
              break;
            case 'tenant':
              claims['tenantId'] = d.tenantId;
              break;
            case 'groups':
              claims['cognito:groups'] = d.groups;
              break;
          }
          for (const k of Object.keys(claims)) {
            if (claims[k] === undefined) delete claims[k];
          }

          // Invalid body and path parameters: any validation would answer 400.
          const event = makeEvent({
            routeKey: route.routeKey,
            ...(eventClaims !== undefined ? { claims: eventClaims } : {}),
            ...(route.bodySchema !== undefined ? { body: `{"invalid":${s.m}` } : {}),
            headers: JSON_HEADERS,
            pathParameters: Object.fromEntries(route.pathParams.map((n) => [n, '!!bad!!'])),
          });

          const rec = makeRecorder();
          const res = await handleRequest(event, {
            service: route.function,
            log: rec.log,
            metrics: rec.metrics,
            now: fixedClock(),
            handlers,
          });

          expect(res.statusCode).toBe(expectedStatus);
          const parsed = JSON.parse(res.body) as { error: string; message: string; fields?: unknown };
          expect(parsed.error).toBe(expectedCode);
          expect(parsed.fields).toBeUndefined();
          expect(res.body).not.toContain(s.m);
          expect(handlerCalls).toBe(0);
        },
      ),
      RUNS,
    );
  });
});

// Feature: b-t08-api-stack, Property 5: The group gate is exact and runs before body validation
// Validates: Requirements 5.9, 6.11, 7.8, 11.1
describe('Property 5: the group gate is exact and runs before body validation', () => {
  const ALL_GROUPS: readonly Group[] = ['Customer', 'Adjuster'];

  it('answers 403 if and only if the group is not allowed, and never 2xx otherwise', async () => {
    const scenario = fc.record({
      route: fc.constantFrom(...ROUTES),
      group: fc.constantFrom(...ALL_GROUPS),
      validBody: fc.boolean(),
      badBody: fc.oneof(fc.string({ maxLength: 60 }), fc.constantFrom('', '{', '[]', 'null', '{"x":1}')),
      validPath: fc.boolean(),
      arrayGroups: fc.boolean(),
    });

    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const route: HandlerRoute = s.route;
        const allowed = route.groups.includes(s.group);
        const validBody = validBodyFor(route);
        const body = s.validBody ? validBody : s.badBody;
        const pathParameters = s.validPath
          ? validPathParametersFor(route)
          : Object.fromEntries(route.pathParams.map((n) => [n, '!!bad!!']));

        const event = makeEvent({
          routeKey: route.routeKey,
          claims: {
            sub: 'sub-1',
            tenantId: 'demo-tenant',
            token_use: 'access',
            'cognito:groups': s.arrayGroups ? [s.group] : `[${s.group}]`,
          },
          ...(route.bodySchema !== undefined && body !== undefined ? { body } : {}),
          headers: JSON_HEADERS,
          ...(pathParameters !== undefined ? { pathParameters } : {}),
        });

        const rec = makeRecorder();
        const res = await handleRequest(event, {
          service: route.function,
          log: rec.log,
          metrics: rec.metrics,
          now: fixedClock(),
        });

        if (allowed) {
          expect(res.statusCode).not.toBe(403);
          expect(res.statusCode < 200 || res.statusCode >= 300).toBe(true);
        } else {
          expect(res.statusCode).toBe(403);
        }
      }),
      RUNS,
    );
  });
});
