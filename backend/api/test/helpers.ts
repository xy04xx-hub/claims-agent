// Owner: B (muzair110)
// Test helpers: payload 2.0 events, example bodies, in-memory sinks and a fixed clock.
import { readFileSync } from 'node:fs';
import type { HandlerRoute } from '../routes.js';
import type { LogSink, MetricsSink, Outcome } from '../middleware/types.js';

export interface EventOptions {
  routeKey: string;
  claims?: unknown;
  body?: string;
  isBase64Encoded?: boolean;
  headers?: Record<string, string>;
  pathParameters?: Record<string, string>;
  requestId?: string | null;
}

export function makeEvent(o: EventOptions): Record<string, unknown> {
  const requestContext: Record<string, unknown> = {};
  if (o.requestId !== null) requestContext['requestId'] = o.requestId ?? 'req-test-1';
  if (o.claims !== undefined) requestContext['authorizer'] = { jwt: { claims: o.claims } };
  const event: Record<string, unknown> = {
    version: '2.0',
    routeKey: o.routeKey,
    headers: o.headers ?? {},
    requestContext,
    isBase64Encoded: o.isBase64Encoded ?? false,
  };
  if (o.body !== undefined) event['body'] = o.body;
  if (o.pathParameters !== undefined) event['pathParameters'] = o.pathParameters;
  return event;
}

export function validClaims(group: 'Customer' | 'Adjuster', extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: 'sub-test-0001',
    'cognito:groups': `[${group}]`,
    tenantId: 'demo-tenant',
    token_use: 'access',
    ...extra,
  };
}

const EXAMPLE_FOR: Record<string, string> = {
  'evidence-upload.request.schema.json': 'evidence-upload',
  'claim-create.request.schema.json': 'claim-create',
  'resolution.request.schema.json': 'resolution',
};

/** The example body for a route that has a body schema, otherwise undefined. */
export function validBodyFor(route: HandlerRoute): string | undefined {
  if (route.bodySchema === undefined) return undefined;
  const name = EXAMPLE_FOR[route.bodySchema]!;
  return readFileSync(new URL(`../../../contracts/api/${name}.request.example.json`, import.meta.url), 'utf8');
}

export const JSON_HEADERS = { 'content-type': 'application/json' };

/** Path parameters that match the patterns of every route. */
export function validPathParametersFor(route: HandlerRoute): Record<string, string> | undefined {
  if (route.pathParams.length === 0) return undefined;
  const values = { claimId: 'CLM-1042', evidenceId: 'EVD-0001' };
  return Object.fromEntries(route.pathParams.map((n) => [n, values[n]]));
}

export interface Recorder {
  log: LogSink;
  metrics: MetricsSink;
  infos: Array<{ message: string; fields: Record<string, unknown> }>;
  errors: Array<{ message: string; fields: Record<string, unknown> }>;
  outcomes: Outcome[];
  flushes: number;
}

export function makeRecorder(): Recorder {
  const r: Recorder = {
    infos: [],
    errors: [],
    outcomes: [],
    flushes: 0,
    log: {
      info: (message, fields) => void r.infos.push({ message, fields }),
      error: (message, fields) => void r.errors.push({ message, fields }),
    },
    metrics: {
      outcome: (o) => void r.outcomes.push(o),
      flush: () => void (r.flushes += 1),
    },
  };
  return r;
}

export function fixedClock(): () => number {
  let t = 1_000;
  return () => (t += 5);
}
