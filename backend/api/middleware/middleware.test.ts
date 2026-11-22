// Owner: B (muzair110)
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { handleRequest, type MiddlewareDeps } from './middleware.js';
import { ROUTES, type HandlerRoute } from '../routes.js';
import type { RouteContext, RouteHandler } from './types.js';
import {
  JSON_HEADERS,
  fixedClock,
  makeEvent,
  makeRecorder,
  validBodyFor,
  validClaims,
  validPathParametersFor,
} from '../test/helpers.js';

const errorSchema = JSON.parse(
  readFileSync(new URL('../../../contracts/api/error.response.schema.json', import.meta.url), 'utf8'),
) as object;
const validateError = new Ajv2020({ strict: false, allErrors: true }).compile(errorSchema);

function deps(service: 'api-customer' | 'api-adjuster', handlers?: Record<string, RouteHandler>) {
  const rec = makeRecorder();
  const d: MiddlewareDeps = { service, log: rec.log, metrics: rec.metrics, now: fixedClock(), handlers };
  return { d, rec };
}

function request(route: HandlerRoute, group: 'Customer' | 'Adjuster', over: Partial<Parameters<typeof makeEvent>[0]> = {}) {
  const body = validBodyFor(route);
  return makeEvent({
    routeKey: route.routeKey,
    claims: validClaims(group),
    body,
    headers: body === undefined ? {} : JSON_HEADERS,
    pathParameters: validPathParametersFor(route),
    ...over,
  });
}

const routeOf = (key: string): HandlerRoute => ROUTES.find((r) => r.routeKey === key)!;
const parse = (body: string) => JSON.parse(body) as { error: string; message: string; fields?: Array<{ path: string }> };

describe('group gate matrix', () => {
  const others = ROUTES.filter((r) => !r.groups.includes('Customer'));
  const customerOnly = ROUTES.filter((r) => !r.groups.includes('Adjuster'));
  it.each(others.map((r) => [r.routeKey]))('Customer token on %s gets 403', async (key) => {
    const route = routeOf(key!);
    const { d } = deps(route.function);
    const res = await handleRequest(request(route, 'Customer'), d);
    expect(res.statusCode).toBe(403);
  });
  it.each(customerOnly.map((r) => [r.routeKey]))('Adjuster token on %s gets 403', async (key) => {
    const route = routeOf(key!);
    const { d } = deps(route.function);
    const res = await handleRequest(request(route, 'Adjuster'), d);
    expect(res.statusCode).toBe(403);
  });
  it('wrong group with an invalid body gets 403, not 400', async () => {
    const route = routeOf('POST /claims/{claimId}/resolution');
    const { d } = deps(route.function);
    const res = await handleRequest(request(route, 'Customer', { body: '{bad', headers: JSON_HEADERS }), d);
    expect(res.statusCode).toBe(403);
  });
});

describe('every route answers 501 for a valid request', () => {
  it.each(ROUTES.flatMap((r) => r.groups.map((g) => [r.routeKey, g] as const)))('%s as %s', async (key, group) => {
    const route = routeOf(key);
    const { d, rec } = deps(route.function);
    const res = await handleRequest(request(route, group), d);
    expect(res.statusCode).toBe(501);
    expect(validateError(parse(res.body))).toBe(true);
    expect(res.headers['x-request-id']).toBe('req-test-1');
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(rec.outcomes).toEqual(['NOT_IMPLEMENTED']);
    expect(rec.flushes).toBe(1);
  });
});

describe('identity defects', () => {
  const route = routeOf('GET /claims');
  const run = async (claims: unknown) => {
    const { d } = deps(route.function);
    return handleRequest(makeEvent({ routeKey: route.routeKey, claims }), d);
  };
  it('ID token gets 401', async () => {
    expect((await run(validClaims('Customer', { token_use: 'id' }))).statusCode).toBe(401);
  });
  it('absent claims get 401', async () => {
    expect((await run(undefined)).statusCode).toBe(401);
  });
  it.each([
    ['missing tenant', { tenantId: undefined }],
    ['invalid tenant', { tenantId: '../x' }],
    ['missing groups', { 'cognito:groups': undefined }],
    ['empty groups', { 'cognito:groups': '' }],
    ['unrecognized group', { 'cognito:groups': '[Admin]' }],
    ['both groups', { 'cognito:groups': '[Customer Adjuster]' }],
  ])('%s gets 403', async (_n, extra) => {
    const res = await run(validClaims('Customer', extra));
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('demo-tenant');
  });
});

describe('body checks', () => {
  const route = routeOf('POST /claims');
  const claim = JSON.parse(validBodyFor(route)!) as Record<string, unknown>;
  const send = async (body: Record<string, unknown>) => {
    const { d } = deps(route.function);
    return handleRequest(
      makeEvent({ routeKey: route.routeKey, claims: validClaims('Customer'), body: JSON.stringify(body), headers: JSON_HEADERS }),
      d,
    );
  };
  it('rejects a 1,001-character description', async () => {
    const res = await send({ ...claim, description: 'x'.repeat(1001) });
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).fields?.map((f) => f.path)).toContain('/description');
  });
  it.each(['tenantId', 'role', 'customerId'])('rejects an undeclared %s', async (name) => {
    const res = await send({ ...claim, [name]: 'attacker' });
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).fields?.map((f) => f.path)).toContain(`/${name}`);
    expect(res.body).not.toContain('attacker');
  });
  it('rejects a bad path parameter with a field entry', async () => {
    const r = routeOf('GET /claims/{claimId}');
    const { d } = deps(r.function);
    const res = await handleRequest(
      makeEvent({ routeKey: r.routeKey, claims: validClaims('Customer'), pathParameters: { claimId: 'nope' } }),
      d,
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).fields?.[0]?.path).toBe('/claimId');
  });
});

describe('routing, requestId and failures', () => {
  it('unknown route key gets 404', async () => {
    const { d } = deps('api-customer');
    const res = await handleRequest(makeEvent({ routeKey: 'GET /queue', claims: validClaims('Adjuster') }), d);
    expect(res.statusCode).toBe(404);
  });
  it('missing requestId gets 500 without requestId', async () => {
    const { d } = deps('api-customer');
    const res = await handleRequest(makeEvent({ routeKey: 'GET /claims', claims: validClaims('Customer'), requestId: null }), d);
    expect(res.statusCode).toBe(500);
    expect(parse(res.body)).not.toHaveProperty('requestId');
    expect(res.headers).not.toHaveProperty('x-request-id');
  });
  it('never throws on garbage events', async () => {
    const { d } = deps('api-customer');
    for (const e of [null, undefined, 5, 'x', [], { requestContext: 7 }]) {
      expect((await handleRequest(e, d)).statusCode).toBe(500);
    }
  });
  it('a throwing handler gets 500 with no thrown text and a minimal log', async () => {
    const route = routeOf('GET /claims');
    const boom: RouteHandler = async () => {
      throw new Error('secret-detail');
    };
    const { d, rec } = deps(route.function, { [route.routeKey]: boom });
    const res = await handleRequest(request(route, 'Customer'), d);
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret-detail');
    expect(JSON.stringify(rec.errors)).not.toContain('secret-detail');
    expect(rec.errors[0]?.fields).toEqual({ requestId: 'req-test-1', errorName: 'Error' });
  });
  it('invokes an injected handler after all checks, with the caller from the claims', async () => {
    const route = routeOf('POST /claims');
    let seen: RouteContext | undefined;
    const h: RouteHandler = async (ctx) => {
      seen = ctx;
      return { statusCode: 202, body: { ok: true } };
    };
    const { d, rec } = deps(route.function, { [route.routeKey]: h });
    const res = await handleRequest(request(route, 'Customer'), d);
    expect(res.statusCode).toBe(202);
    expect(seen?.caller).toEqual({ sub: 'sub-test-0001', group: 'Customer', tenantId: 'demo-tenant' });
    expect(rec.infos).toHaveLength(1);
    expect(rec.infos[0]?.fields).toMatchObject({ group: 'Customer', tenantId: 'demo-tenant', outcome: 'OK' });
    expect(JSON.stringify(rec.infos)).not.toContain('sub-test-0001');
    // A handler is not reached when a check fails.
    seen = undefined;
    await handleRequest(request(route, 'Adjuster'), d);
    expect(seen).toBeUndefined();
  });
});
