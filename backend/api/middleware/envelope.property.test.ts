// Owner: B (muzair110)
// Feature: b-t08-api-stack, Property 10
// **Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.5, 11.5**
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ROUTES, routesOf, type FunctionName, type HandlerRoute } from '../routes.js';
import {
  JSON_HEADERS,
  fixedClock,
  makeEvent,
  makeRecorder,
  validBodyFor,
  validClaims,
  validPathParametersFor,
} from '../test/helpers.js';
import { handleRequest, type MiddlewareDeps } from './middleware.js';
import type { RouteHandler } from './types.js';

const RUNS = { numRuns: 100 };
const ALLOWED_STATUS = [400, 401, 403, 404, 500, 501];

const errorSchema = JSON.parse(
  readFileSync(new URL('../../../contracts/api/error.response.schema.json', import.meta.url), 'utf8'),
) as object;
const validateError = new Ajv2020({ strict: false, allErrors: true }).compile(errorSchema);

const services: readonly FunctionName[] = ['api-customer', 'api-adjuster'];
const service = fc.constantFrom(...services);

function makeDeps(name: FunctionName, handlers?: Record<string, RouteHandler>): MiddlewareDeps {
  const rec = makeRecorder();
  return { service: name, log: rec.log, metrics: rec.metrics, now: fixedClock(), handlers };
}

const knownRouteKeys = ROUTES.map((r) => r.routeKey);
const routeKey: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom(...knownRouteKeys),
  fc.string(),
  fc.anything(),
);
const claims: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(undefined),
  fc.anything(),
  fc.constantFrom('Customer', 'Adjuster').chain((g) =>
    fc.record({
      sub: fc.string(),
      'cognito:groups': fc.oneof(fc.constant(`[${g}]`), fc.string(), fc.anything()),
      tenantId: fc.oneof(fc.constant('demo-tenant'), fc.string()),
      token_use: fc.constantFrom('access', 'id', 'other'),
    }),
  ),
);
const requestId: fc.Arbitrary<unknown> = fc.oneof(fc.string(), fc.anything());

const structuredEvent: fc.Arbitrary<unknown> = fc.record(
  {
    version: fc.constant('2.0'),
    routeKey,
    headers: fc.oneof(fc.dictionary(fc.string(), fc.string()), fc.anything()),
    body: fc.oneof(fc.string(), fc.jsonValue().map((v) => JSON.stringify(v)), fc.anything()),
    isBase64Encoded: fc.oneof(fc.boolean(), fc.anything()),
    pathParameters: fc.oneof(fc.dictionary(fc.string(), fc.string()), fc.anything()),
    requestContext: fc.record(
      {
        requestId,
        authorizer: fc.record({ jwt: fc.record({ claims }, { requiredKeys: [] }) }, { requiredKeys: [] }),
      },
      { requiredKeys: [] },
    ),
  },
  { requiredKeys: [] },
);

const anyEvent: fc.Arbitrary<unknown> = fc.oneof(fc.anything(), fc.jsonValue(), structuredEvent);

function checkEnvelope(res: Awaited<ReturnType<typeof handleRequest>>, event: unknown): void {
  expect(ALLOWED_STATUS).toContain(res.statusCode);
  expect(res.headers['content-type']).toBe('application/json');
  expect(res.headers['cache-control']).toBe('no-store');
  const body: unknown = JSON.parse(res.body);
  expect(validateError(body)).toBe(true);
  const id = (event as { requestContext?: { requestId?: unknown } } | null)?.requestContext?.requestId;
  const parsed = body as { requestId?: string };
  if (typeof id === 'string' && id.length > 0 && typeof event === 'object' && event !== null && !Array.isArray(event)) {
    expect(parsed.requestId).toBe(id);
    expect(res.headers['x-request-id']).toBe(id);
  } else {
    expect(parsed).not.toHaveProperty('requestId');
    expect(res.headers).not.toHaveProperty('x-request-id');
  }
}

describe('Property 10: every response has the same envelope, and the handler never throws', () => {
  it('any event gets an error envelope with an allowed status', async () => {
    await fc.assert(
      fc.asyncProperty(service, anyEvent, async (name, event) => {
        const res = await handleRequest(event, makeDeps(name));
        checkEnvelope(res, event);
      }),
      RUNS,
    );
  });

  it('a route key outside the function table gives 404', async () => {
    await fc.assert(
      fc.asyncProperty(
        service,
        fc.oneof(fc.string(), fc.constantFrom(...knownRouteKeys)),
        fc.constantFrom('Customer', 'Adjuster'),
        fc.string({ minLength: 1 }),
        async (name, key, group, id) => {
          fc.pre(!routesOf(name).has(key));
          const event = makeEvent({ routeKey: key, claims: validClaims(group), requestId: id });
          const res = await handleRequest(event, makeDeps(name));
          expect(res.statusCode).toBe(404);
          checkEnvelope(res, event);
        },
      ),
      RUNS,
    );
  });

  it('a throwing handler gives 500 Internal error with no thrown text', async () => {
    const routes: readonly HandlerRoute[] = ROUTES;
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...routes),
        fc.uuid(),
        fc.string({ minLength: 1 }),
        fc.boolean(),
        async (route, secret, id, throwError) => {
          const thrown = `boom-${secret}`;
          const handler: RouteHandler = async () => {
            if (throwError) throw new Error(thrown);
            throw thrown;
          };
          const body = validBodyFor(route);
          const event = makeEvent({
            routeKey: route.routeKey,
            claims: validClaims(route.groups[0]!),
            body,
            headers: body === undefined ? {} : JSON_HEADERS,
            pathParameters: validPathParametersFor(route),
            requestId: id,
          });
          const res = await handleRequest(event, makeDeps(route.function, { [route.routeKey]: handler }));
          expect(res.statusCode).toBe(500);
          expect(res.body).not.toContain(secret);
          const parsed = JSON.parse(res.body) as { error: string; message: string };
          expect(parsed.error).toBe('INTERNAL_ERROR');
          expect(parsed.message).toBe('Internal error');
          checkEnvelope(res, event);
        },
      ),
      RUNS,
    );
  });
});
