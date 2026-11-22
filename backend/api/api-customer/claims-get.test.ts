// T-09 task 7.2: GET /claims/{claimId} (requirement 13.3).
import { describe, expect, it } from 'vitest';
import { handleRequest } from '../middleware/middleware.js';
import { fixedClock, makeEvent, makeRecorder, validClaims } from '../test/helpers.js';
import { createClaimsGetHandler } from './claims-get.js';

const ROUTE = 'GET /claims/{claimId}';
const SUB = 'sub-test-0001';

const claimItem = {
  claimId: 'CLM-1042',
  customerId: SUB,
  status: 'ROUTED_TO_ADJUSTER',
  createdAt: '2026-01-01T00:00:00.000Z',
  decision: { reasons: { customer: 'Needs review.', adjuster: ['Amount over cap'] } },
};

function run(claims: unknown, item: Record<string, unknown> | undefined) {
  const rec = makeRecorder();
  const handler = createClaimsGetHandler({ repo: { getClaimItem: async () => item as never } });
  return handleRequest(
    makeEvent({ routeKey: ROUTE, claims, pathParameters: { claimId: 'CLM-1042' } }),
    { service: 'api-customer', log: rec.log, metrics: rec.metrics, now: fixedClock(), handlers: { [ROUTE]: handler } },
  );
}

const parse = (r: { body?: string }) => JSON.parse(r.body ?? '{}') as Record<string, unknown>;

describe('claims-get', () => {
  it("returns 404 for another customer's claim", async () => {
    const res = await run(validClaims('Customer', { sub: 'someone-else' }), claimItem);
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 for an ID token', async () => {
    const res = await run(validClaims('Customer', { token_use: 'id' }), claimItem);
    expect(res.statusCode).toBe(401);
  });

  it('returns own claim without adjusterReasons', async () => {
    const res = await run(validClaims('Customer'), claimItem);
    expect(res.statusCode).toBe(200);
    const body = parse(res);
    expect(body.claimId).toBe('CLM-1042');
    expect(body.customerMessage).toBe('Needs review.');
    expect(body).not.toHaveProperty('adjusterReasons');
  });

  it('shows adjusterReasons to an adjuster', async () => {
    const res = await run(validClaims('Adjuster', { sub: 'adj-1' }), claimItem);
    expect(res.statusCode).toBe(200);
    expect(parse(res).adjusterReasons).toEqual(['Amount over cap']);
  });
});
