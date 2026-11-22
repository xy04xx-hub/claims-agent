import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PATH_PARAM_PATTERNS, TENANT_PATTERN } from './middleware/limits.js';
import { ROUTES, routesOf } from './routes.js';
import { TENANT } from '../../infra/lib/constructs/platform/auth-model.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const EXPECTED: ReadonlyArray<readonly [string, string, string]> = [
  ['GET /me/policies', 'api-customer', 'Customer'],
  ['POST /evidence/uploads', 'api-customer', 'Customer'],
  ['POST /claims', 'api-customer', 'Customer'],
  ['GET /claims', 'api-customer', 'Customer'],
  ['GET /claims/{claimId}', 'api-customer', 'Customer,Adjuster'],
  ['GET /claims/{claimId}/evidence/{evidenceId}', 'api-customer', 'Customer,Adjuster'],
  ['GET /queue', 'api-adjuster', 'Adjuster'],
  ['POST /claims/{claimId}/resolution', 'api-adjuster', 'Adjuster'],
  ['GET /impact', 'api-adjuster', 'Adjuster'],
];

describe('handler route table', () => {
  it('lists the nine routes with function and groups', () => {
    expect(ROUTES.map((r) => [r.routeKey, r.function, r.groups.join(',')])).toEqual(EXPECTED);
  });

  it('has body schema files that exist in contracts/api, on exactly three routes', () => {
    const withBody = ROUTES.filter((r) => r.bodySchema !== undefined);
    expect(withBody.map((r) => r.routeKey)).toEqual([
      'POST /evidence/uploads',
      'POST /claims',
      'POST /claims/{claimId}/resolution',
    ]);
    for (const r of withBody) {
      expect(existsSync(resolve(HERE, '../../contracts/api', r.bodySchema as string))).toBe(true);
    }
  });

  it('names path parameters that appear in the route key, and all of them', () => {
    for (const r of ROUTES) {
      const inKey = [...r.routeKey.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      expect([...r.pathParams]).toEqual(inKey);
      for (const p of r.pathParams) expect(PATH_PARAM_PATTERNS[p]).toBeInstanceOf(RegExp);
    }
  });

  it('marks every route NOT_IMPLEMENTED with its ticket', () => {
    for (const r of ROUTES) expect(r.state).toBe('NOT_IMPLEMENTED');
    const tickets = Object.fromEntries(ROUTES.map((r) => [r.routeKey, r.ticket]));
    expect(tickets['GET /impact']).toBe('T-24');
    expect(tickets['GET /queue']).toBe('T-10');
    expect(tickets['POST /claims/{claimId}/resolution']).toBe('T-10');
    expect(tickets['GET /claims/{claimId}/evidence/{evidenceId}']).toBe('T-10');
    expect(tickets['POST /claims']).toBe('T-09');
  });

  it('splits the routes into two disjoint sets by function', () => {
    const customer = routesOf('api-customer');
    const adjuster = routesOf('api-adjuster');
    expect(customer.size).toBe(6);
    expect(adjuster.size).toBe(3);
    for (const key of customer.keys()) expect(adjuster.has(key)).toBe(false);
  });

  it('keeps the tenant pattern equal to the auth model', () => {
    expect(TENANT_PATTERN.source).toBe(TENANT.pattern.source);
  });
});
