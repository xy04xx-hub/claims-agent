// Owner: B (muzair110)
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BODY_LIMIT_BYTES } from './limits.js';
import { handleRequest, type MiddlewareDeps } from './middleware.js';
import { readBody } from './request-body.js';
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

const claimRoute = bodyRoutes.find((r) => r.bodySchema === 'claim-create.request.schema.json')!;

// Limits read from the contract so the test follows the schema.
const claimSchema = JSON.parse(
  readFileSync(new URL('../../../contracts/api/claim-create.request.schema.json', import.meta.url), 'utf8'),
) as {
  properties: {
    description: { maxLength: number };
    evidenceIds: { maxItems: number };
    amountClaimed: { maximum: number };
  };
};
const MAX_DESCRIPTION = claimSchema.properties.description.maxLength;
const MAX_EVIDENCE = claimSchema.properties.evidenceIds.maxItems;
const MAX_AMOUNT = claimSchema.properties.amountClaimed.maximum;

interface Violation {
  property: 'description' | 'evidenceIds' | 'amountClaimed';
  value: string | string[] | number;
  /** Strings that must not appear in any message. */
  secrets: string[];
}

const evidenceId = fc.stringMatching(/^[A-Za-z0-9]{1,40}$/).map((s) => `EVD-${s}`);

const violation: fc.Arbitrary<Violation> = fc.oneof(
  fc
    .tuple(fc.constantFrom('q', 'Z', '7', 'ü'), fc.integer({ min: MAX_DESCRIPTION + 1, max: MAX_DESCRIPTION + 2000 }))
    .map(([ch, n]): Violation => {
      const value = ch.repeat(n);
      return { property: 'description', value, secrets: [value] };
    }),
  fc
    .uniqueArray(evidenceId, { minLength: MAX_EVIDENCE + 1, maxLength: MAX_EVIDENCE + 14 })
    .map((value): Violation => ({ property: 'evidenceIds', value, secrets: [...value, JSON.stringify(value)] })),
  fc
    .integer({ min: MAX_AMOUNT + 1, max: 2_000_000_000 })
    .map((value): Violation => ({ property: 'amountClaimed', value, secrets: [String(value)] })),
);

// Feature: b-t08-api-stack, Property 7: Limit violations are rejected with field errors that hold no values
// Validates: Requirements 6.2, 6.4, 6.5
describe('Property 7: limit violations are rejected with field errors that hold no values', () => {
  it('answers 400 with bounded field errors that name the property and never echo the value', async () => {
    await fc.assert(
      fc.asyncProperty(violation, async (v) => {
        const valid = JSON.parse(validBodyFor(claimRoute)!) as Record<string, unknown>;
        const body = JSON.stringify({ ...valid, [v.property]: v.value });

        let handlerCalls = 0;
        const handler: RouteHandler = async () => {
          handlerCalls += 1;
          return { statusCode: 200, body: {} };
        };
        const rec = makeRecorder();
        const deps: MiddlewareDeps = {
          service: claimRoute.function,
          log: rec.log,
          metrics: rec.metrics,
          now: fixedClock(),
          handlers: { [claimRoute.routeKey]: handler },
        };
        const res: Reply = await handleRequest(
          makeEvent({
            routeKey: claimRoute.routeKey,
            claims: validClaims(claimRoute.groups[0]!),
            body,
            headers: JSON_HEADERS,
            pathParameters: validPathParametersFor(claimRoute),
          }),
          deps,
        );

        expect(res.statusCode).toBe(400);
        const parsed = JSON.parse(res.body) as { error: string; fields?: Array<{ path: string; message: string }> };
        expect(parsed.error).toBe('BAD_REQUEST');
        const fields = parsed.fields ?? [];
        expect(fields.length).toBeGreaterThan(0);
        expect(fields.length).toBeLessThanOrEqual(20);
        for (const f of fields) {
          expect(f.path.length).toBeLessThanOrEqual(200);
          expect(f.message.length).toBeLessThanOrEqual(200);
          for (const s of v.secrets) expect(f.message).not.toContain(s);
        }
        expect(fields.some((f) => f.path === `/${v.property}` || f.path.startsWith(`/${v.property}/`))).toBe(true);
        expect(handlerCalls).toBe(0);
      }),
      RUNS,
    );
  });
});

const TOO_LARGE = 'Request body is too large';

type BodyKind = 'valid-object' | 'invalid-json' | 'non-object';

// Builds text of exactly `bytes` UTF-8 bytes. Multibyte filler (2 bytes per character) keeps the
// byte length fixed while the character count drops, so a char-length check would disagree.
function textOfBytes(kind: BodyKind, bytes: number, multibytePairs: number): string {
  const [open, close] =
    kind === 'valid-object' ? ['{"x":"', '"}'] : kind === 'non-object' ? ['"', '"'] : ['{"x":"', ''];
  const filler = bytes - open.length - close.length;
  const pairs = Math.min(multibytePairs, Math.floor(filler / 2));
  return open + 'é'.repeat(pairs) + 'a'.repeat(filler - 2 * pairs) + close;
}

const sizedBody = fc
  .record({
    kind: fc.constantFrom<BodyKind>('valid-object', 'invalid-json', 'non-object'),
    bytes: fc.integer({ min: BODY_LIMIT_BYTES - 64, max: BODY_LIMIT_BYTES + 64 }),
    multibytePairs: fc.integer({ min: 0, max: 200 }),
    base64: fc.boolean(),
  })
  .map((r) => ({ ...r, text: textOfBytes(r.kind, r.bytes, r.multibytePairs) }));

// Feature: b-t08-api-stack, Property 8: Oversized bodies are rejected by size alone
// Validates: Requirements 6.6, 6.9
describe('Property 8: oversized bodies are rejected by size alone', () => {
  it('rejects exactly the bodies above 16 KiB of decoded bytes, whatever the content', () => {
    fc.assert(
      fc.property(sizedBody, ({ text, bytes, base64 }) => {
        expect(Buffer.byteLength(text, 'utf8')).toBe(bytes);
        const result = readBody(
          {
            body: base64 ? Buffer.from(text, 'utf8').toString('base64') : text,
            isBase64Encoded: base64,
            headers: JSON_HEADERS,
          },
          'claim-create.request.schema.json',
        );
        if (bytes > BODY_LIMIT_BYTES) {
          expect(result).toEqual({ ok: false, message: TOO_LARGE });
        } else if (!result.ok) {
          expect(result.message).not.toBe(TOO_LARGE);
        }
      }),
      RUNS,
    );
  });

  it('counts multibyte UTF-8 as bytes, not characters', () => {
    // 8,193 two-byte characters: 8,193 characters (under the limit) but 16,386 bytes (over it).
    const text = `"${'é'.repeat(8193)}"`;
    expect(text.length).toBeLessThan(BODY_LIMIT_BYTES);
    expect(readBody({ body: text, headers: JSON_HEADERS }, 'claim-create.request.schema.json')).toEqual({
      ok: false,
      message: TOO_LARGE,
    });
  });
});
