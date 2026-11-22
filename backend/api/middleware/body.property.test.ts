// Owner: B (muzair110)
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { handleRequest, type MiddlewareDeps } from './middleware.js';
import { ROUTES } from '../routes.js';
import type { RouteHandler } from './types.js';
import {
  JSON_HEADERS,
  fixedClock,
  makeEvent,
  makeRecorder,
  validBodyFor,
  validClaims,
  validPathParametersFor,
} from '../test/helpers.js';

const RUNS = { numRuns: 100 };

const bodyRoutes = ROUTES.filter((r) => r.bodySchema !== undefined);

function declaredProperties(schemaFile: string): Set<string> {
  const schema = JSON.parse(
    readFileSync(new URL(`../../../contracts/api/${schemaFile}`, import.meta.url), 'utf8'),
  ) as { properties: Record<string, unknown> };
  return new Set(Object.keys(schema.properties));
}

// Mirrors the documented sanitizing: at most 60 characters, only [A-Za-z0-9_$.-] kept.
const sanitize = (name: string): string => name.slice(0, 60).replace(/[^A-Za-z0-9_$.-]/g, '_');

const undeclaredName = fc.oneof(
  fc.string({ maxLength: 80 }),
  fc.constantFrom('tenantId', 'role', 'group', 'customerId', 'sub', 'cognito:groups', '__proto__', 'a b'),
);

const jsonValue = fc.jsonValue({ maxDepth: 2 });

interface Reply {
  statusCode: number;
  body: string;
}

// Feature: b-t08-api-stack, Property 6: Undeclared body properties are rejected and named
// Validates: Requirements 6.2, 6.3, 6.12, 11.2, 11.3, 11.6
describe('Property 6: undeclared body properties are rejected and named', () => {
  it('answers 400 BAD_REQUEST naming the sanitized property, never 501, never calling the handler', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...bodyRoutes),
        undeclaredName,
        jsonValue,
        async (route, name, value) => {
          const declared = declaredProperties(route.bodySchema!);
          fc.pre(!declared.has(name));
          const valid = JSON.parse(validBodyFor(route)!) as Record<string, unknown>;
          const body = JSON.stringify({ ...valid, [name]: value });

          let handlerCalls = 0;
          const handler: RouteHandler = async () => {
            handlerCalls += 1;
            return { statusCode: 200, body: {} };
          };
          const rec = makeRecorder();
          const deps: MiddlewareDeps = {
            service: route.function,
            log: rec.log,
            metrics: rec.metrics,
            now: fixedClock(),
            handlers: { [route.routeKey]: handler },
          };
          const group = route.groups[0]!;
          const res: Reply = await handleRequest(
            makeEvent({
              routeKey: route.routeKey,
              claims: validClaims(group),
              body,
              headers: JSON_HEADERS,
              pathParameters: validPathParametersFor(route),
            }),
            deps,
          );

          expect(res.statusCode).toBe(400);
          expect(res.statusCode).not.toBe(501);
          const parsed = JSON.parse(res.body) as { error: string; fields?: Array<{ path: string }> };
          expect(parsed.error).toBe('BAD_REQUEST');
          const paths = (parsed.fields ?? []).map((f) => f.path);
          expect(paths).toContain(`/${sanitize(name)}`);
          expect(handlerCalls).toBe(0);
        },
      ),
      RUNS,
    );
  });
});
