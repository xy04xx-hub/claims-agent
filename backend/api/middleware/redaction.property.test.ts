// Owner: B (muzair110)
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { handleRequest } from './middleware.js';
import type { Outcome, RouteHandler } from './types.js';
import { JSON_HEADERS, fixedClock, makeEvent, makeRecorder, validBodyFor, validClaims } from '../test/helpers.js';
import { ROUTES } from '../routes.js';

const RUNS = { numRuns: 100 };
const OUTCOMES: readonly Outcome[] = [
  'NOT_IMPLEMENTED',
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INTERNAL_ERROR',
];
const INFO_KEYS = ['requestId', 'routeKey', 'group', 'tenantId', 'outcome', 'durationMs'];

const claimsRoute = ROUTES.find((r) => r.routeKey === 'POST /claims')!;
const claimBody = JSON.parse(validBodyFor(claimsRoute)!) as Record<string, unknown>;

// Unique marker prefix so a secret cannot collide with fixed log text.
const secret = fc
  .string({ unit: fc.constantFrom(...'0123456789abcdef'), minLength: 8, maxLength: 24 })
  .map((s) => `SECRET${s}`);

type Scenario =
  | 'ok'
  | 'throws'
  | 'not-implemented'
  | 'extra-property'
  | 'bad-json'
  | 'wrong-group'
  | 'id-token'
  | 'no-tenant'
  | 'no-request-id'
  | 'unknown-route';

const scenario = fc.constantFrom<Scenario>(
  'ok',
  'throws',
  'not-implemented',
  'extra-property',
  'bad-json',
  'wrong-group',
  'id-token',
  'no-tenant',
  'no-request-id',
  'unknown-route',
);

// Feature: b-t08-api-stack, Property 11: Logs and metrics hold no secrets and carry the required fields
// Validates: Requirements 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.7
describe('Property 11: redaction and required log fields', () => {
  it('keeps secrets out of logs and metrics and writes one complete info record', async () => {
    await fc.assert(
      fc.asyncProperty(
        scenario,
        secret,
        secret,
        secret,
        secret,
        secret,
        async (kind, token, sub, bodyValue, authValue, errorText) => {
          const rec = makeRecorder();
          const secrets = [token, sub, bodyValue, authValue, errorText];
          const handlers: Record<string, RouteHandler> = {
            'POST /claims': async () => {
              if (kind === 'throws') throw new Error(errorText);
              return { statusCode: 200, body: { done: true } };
            },
          };
          const authHeaders = { authorization: `Bearer ${authValue}`, 'x-token': token };
          const goodClaims = validClaims('Customer', { sub, 'custom:token': token });
          const base = {
            routeKey: 'POST /claims',
            claims: goodClaims,
            headers: { ...JSON_HEADERS, ...authHeaders },
            body: JSON.stringify({ ...claimBody, description: bodyValue }),
          };
          const overrides: Record<Scenario, Parameters<typeof makeEvent>[0]> = {
            ok: base,
            throws: base,
            'not-implemented': base,
            'extra-property': { ...base, body: JSON.stringify({ ...claimBody, [bodyValue]: bodyValue }) },
            'bad-json': { ...base, body: `{${bodyValue}` },
            'wrong-group': { ...base, claims: validClaims('Adjuster', { sub }) },
            'id-token': { ...base, claims: validClaims('Customer', { sub, token_use: 'id' }) },
            'no-tenant': { ...base, claims: validClaims('Customer', { sub, tenantId: undefined }) },
            'no-request-id': { ...base, requestId: null },
            'unknown-route': { ...base, routeKey: 'GET /queue' },
          };
          const res = await handleRequest(makeEvent(overrides[kind]), {
            service: 'api-customer',
            log: rec.log,
            metrics: rec.metrics,
            now: fixedClock(),
            handlers: kind === 'not-implemented' ? undefined : handlers,
          });

          // No secret in any record or metric value.
          const captured = JSON.stringify({ i: rec.infos, e: rec.errors, m: rec.outcomes });
          for (const s of secrets) expect(captured).not.toContain(s);

          // Exactly one info record with the six keys.
          expect(rec.infos).toHaveLength(1);
          expect(Object.keys(rec.infos[0]!.fields).sort()).toEqual([...INFO_KEYS].sort());

          // Every record has a requestId.
          for (const r of [...rec.infos, ...rec.errors]) {
            expect(typeof r.fields['requestId']).toBe('string');
            expect((r.fields['requestId'] as string).length).toBeGreaterThan(0);
          }

          // Flush runs once; the outcome metric is one of the allowed values.
          expect(rec.flushes).toBe(1);
          expect(rec.outcomes.length).toBeLessThanOrEqual(1);
          for (const o of rec.outcomes) expect(OUTCOMES).toContain(o);
          expect(res.body).not.toContain(errorText);
        },
      ),
      RUNS,
    );
  });
});

describe('redaction sanity', () => {
  it('a throwing handler logs only the error name', async () => {
    const rec = makeRecorder();
    await handleRequest(
      makeEvent({
        routeKey: 'POST /claims',
        claims: validClaims('Customer'),
        headers: JSON_HEADERS,
        body: JSON.stringify(claimBody),
      }),
      {
        service: 'api-customer',
        log: rec.log,
        metrics: rec.metrics,
        now: fixedClock(),
        handlers: {
          'POST /claims': async () => {
            throw new Error('boom-secret');
          },
        },
      },
    );
    expect(rec.errors).toHaveLength(1);
    expect(JSON.stringify(rec.errors)).not.toContain('boom-secret');
    expect(rec.outcomes).toEqual(['INTERNAL_ERROR']);
  });
});
