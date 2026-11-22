// Owner: B (muzair110)
// Feature: b-t08-api-stack, Property 12
// **Validates: Requirements 1.4, 1.5, 2.5, 2.6, 3.1, 11.11**
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_LOG_FIELDS,
  ACCESS_LOG_RETENTION_DAYS,
  accessLogFormat,
  API_ROUTES,
  buildAudience,
  FUNCTION_SETTINGS,
  INTEGRATION_TIMEOUT_SECONDS,
  parseRouteKey,
  routeConstructId,
  THROTTLE,
} from '../lib/constructs/platform/api-model.js';

const RUNS = { numRuns: 100 };

const clientIdArb = fc.stringMatching(/^[a-z0-9]{1,40}$/);

describe('buildAudience (Property 12)', () => {
  it('has one entry without a verification client, two with a different one, never empty or duplicated', () => {
    fc.assert(
      fc.property(clientIdArb, fc.option(clientIdArb, { nil: undefined }), (app, verification) => {
        fc.pre(verification !== app);
        const audience = buildAudience(app, verification);
        expect(audience.length).toBeGreaterThan(0);
        expect(new Set(audience).size).toBe(audience.length);
        if (verification === undefined) {
          expect(audience).toEqual([app]);
        } else {
          expect(audience).toEqual([app, verification]);
        }
      }),
      RUNS,
    );
  });

  it('collapses an equal verification client into one entry', () => {
    fc.assert(
      fc.property(clientIdArb, (id) => {
        expect(buildAudience(id, id)).toEqual([id]);
      }),
      RUNS,
    );
  });

  it('throws for an empty app client id', () => {
    expect(() => buildAudience('', undefined)).toThrow();
    expect(() => buildAudience('', 'abc')).toThrow();
  });
});

describe('api model', () => {
  it('lists the nine documented routes', () => {
    expect(API_ROUTES.map((r) => r.routeKey)).toEqual([
      'GET /me/policies',
      'POST /evidence/uploads',
      'POST /claims',
      'GET /claims',
      'GET /claims/{claimId}',
      'GET /claims/{claimId}/evidence/{evidenceId}',
      'GET /queue',
      'POST /claims/{claimId}/resolution',
      'GET /impact',
    ]);
  });

  it('gives each route a unique construct id', () => {
    const ids = API_ROUTES.map((r) => routeConstructId(r));
    expect(new Set(ids).size).toBe(ids.length);
    expect(routeConstructId({ method: 'GET', path: '/claims/{claimId}/evidence/{evidenceId}' })).toBe(
      'GetClaimsClaimIdEvidenceEvidenceId',
    );
  });

  it('parses each route key back to its method and path', () => {
    for (const r of API_ROUTES) {
      expect(parseRouteKey(r.routeKey)).toEqual({ method: r.method, path: r.path });
    }
  });

  it('rejects malformed route keys', () => {
    expect(() => parseRouteKey('PUT /claims')).toThrow();
    expect(() => parseRouteKey('GET claims')).toThrow();
  });

  it('logs exactly the eleven allowed fields and no forbidden variable', () => {
    expect(Object.keys(ACCESS_LOG_FIELDS)).toEqual([
      'requestId',
      'requestTime',
      'httpMethod',
      'routeKey',
      'status',
      'responseLength',
      'responseLatency',
      'integrationLatency',
      'integrationStatus',
      'errorMessage',
      'authorizerError',
    ]);
    const format = accessLogFormat();
    for (const forbidden of ['sourceIp', 'identity', 'claims', 'principal', 'requestHeaders', 'queryString', 'path', 'body']) {
      expect(format).not.toContain(forbidden);
    }
  });

  it('uses the documented constants', () => {
    expect(THROTTLE).toEqual({ rateLimit: 20, burstLimit: 40 });
    expect(FUNCTION_SETTINGS).toEqual({ timeoutSeconds: 10, memorySize: 256 });
    expect(INTEGRATION_TIMEOUT_SECONDS).toBe(10);
    expect(ACCESS_LOG_RETENTION_DAYS).toBe(14);
  });
});
