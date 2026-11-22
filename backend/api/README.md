# backend/api
Owner: B (muzair110)

## Purpose

Lambda code for the two API functions, `api-customer` and `api-adjuster`, and the middleware they share. API Gateway has already verified the Cognito access token when a request arrives. The middleware reads the caller from the verified claims, checks the route, the group, the path parameters and the body, and then calls a route handler. In T-08 no route has a handler yet, so every request that passes the checks answers `501`. T-09 and T-10 add the handlers.

## Pipeline

`handleRequest` in `middleware/middleware.ts` runs these steps in order. The first failing step answers, and later steps do not run. The function never throws.

1. Read `requestContext.requestId`. If it is missing, answer `500` without a `requestId` field.
2. Read the claims from `requestContext.authorizer.jwt.claims`. If they are not an object, answer `401`.
3. Check `token_use` equals `access`, else `401` with the message `An access token is required`. An ID token is rejected here.
4. Check `sub` is a string of 1 to 128 characters, else `403`.
5. Check `tenantId` matches `^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$`, else `403`.
6. Parse `cognito:groups` and require exactly one recognized group (`Customer` or `Adjuster`, case sensitive), else `403`.
7. Look the route key up in the table of the function (`api-customer` or `api-adjuster`). Unknown route gives `404`.
8. Group gate: the caller group must be allowed for the route, else `403`. This runs before any path or body check, so a wrong-group request with an invalid body gets `403`, not `400`.
9. Validate path parameters, else `400` with `fields`.
10. Read and validate the body (routes with a body schema only), else `400` with `fields`.
11. Dispatch. A handler registered for the route key runs. Without one, answer `501`. A handler that throws gives `500`.

After the answer is chosen, one `info` log line is written (`requestId`, `routeKey`, `group`, `tenantId`, `outcome`, `durationMs`), the outcome metric is recorded for every non-success status, and the metrics are flushed. Telemetry errors never change the answer.

## Routes

Defined in `routes.ts` (`ROUTES`). The same table is `API_ROUTES` in `infra/lib/constructs/platform/api-model.ts`, and a test checks that the two agree.

| Route | Function | Groups | Body schema | Path parameters | Implemented by |
|---|---|---|---|---|---|
| `GET /me/policies` | `api-customer` | Customer | none | none | T-09 |
| `POST /evidence/uploads` | `api-customer` | Customer | `evidence-upload.request.schema.json` | none | T-09 |
| `POST /claims` | `api-customer` | Customer | `claim-create.request.schema.json` | none | T-09 |
| `GET /claims` | `api-customer` | Customer | none | none | T-09 |
| `GET /claims/{claimId}` | `api-customer` | Customer, Adjuster | none | `claimId` | T-09 |
| `GET /claims/{claimId}/evidence/{evidenceId}` | `api-customer` | Customer, Adjuster | none | `claimId`, `evidenceId` | T-10 |
| `GET /queue` | `api-adjuster` | Adjuster | none | none | T-10 |
| `POST /claims/{claimId}/resolution` | `api-adjuster` | Adjuster | `resolution.request.schema.json` | `claimId` | T-10 |
| `GET /impact` | `api-adjuster` | Adjuster | none | none | T-24 |

Body schemas are in `contracts/api`. Path parameters must match `^CLM-[A-Za-z0-9-]{1,40}$` (`claimId`) and `^EVD-[A-Za-z0-9-]{1,40}$` (`evidenceId`).

## Error shape

Every non-success answer from these functions uses the body in `contracts/api/error.response.schema.json`, with headers `content-type: application/json`, `cache-control: no-store` and `x-request-id`.

```json
{
  "error": "BAD_REQUEST",
  "message": "Request body is invalid",
  "requestId": "req-123",
  "fields": [{ "path": "/description", "message": "must be at most 1000 characters" }]
}
```

| Status | `error` | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Invalid path parameter or body. `fields` lists up to 20 entries (`path` and `message`, each at most 200 characters). Messages are built from the rule, never from the submitted value |
| 401 | `UNAUTHORIZED` | No claims, or the token is not an access token |
| 403 | `FORBIDDEN` | Bad `sub`, bad `tenantId`, no or several recognized groups, or the group is not allowed for the route |
| 404 | `NOT_FOUND` | Route key not served by this function |
| 500 | `INTERNAL_ERROR` | Missing request ID, a handler threw, or any unexpected error. The message is always `Internal error` |
| 501 | `NOT_IMPLEMENTED` | The route passed every check and has no handler yet |

The `401` for a missing, expired or invalid token comes from API Gateway before the Lambda runs, and its body is `{"message":"Unauthorized"}`. It does not use this shape.

## Limits

| Limit | Value |
|---|---|
| Request body | 16 KiB after decoding (`BODY_LIMIT_BYTES`). Checked before parsing. For base64 bodies the size is estimated before decoding |
| Body type | `Content-Type` must be `application/json` (parameters and case are ignored). The body must be a JSON object |
| Field errors | At most 20 per response, at most 200 characters each |
| `sub` | 1 to 128 characters |

The limits are in `middleware/limits.ts`. Field limits such as `description` (1,000 characters) and `evidenceIds` (6) come from the contract schemas. The schemas also reject undeclared properties, so a body that carries `tenantId`, `role` or `customerId` gets `400`.

## Claims and groups

Role and tenant come only from the verified claims: `cognito:groups` and `tenantId` (added by the pre token generation trigger in `backend/auth`). `caller.ts` is the only code that reads them. Headers, query string and body are never used for identity, and a handler receives the result as `ctx.caller`. A source scan test enforces this.

API Gateway passes `cognito:groups` to the Lambda as a string, not an array. A user in `Customer` arrives as `"[Customer]"`. `parseGroups` in `middleware/groups.ts` never throws and handles these forms:

| Input | Result |
|---|---|
| Array of strings | Each entry trimmed, empty entries dropped. Other entry types are skipped |
| `"[Customer Adjuster]"` or `"[Customer, Adjuster]"` | Split on spaces and commas, quotes removed |
| `"[\"Customer\"]"` (JSON array text) | Parsed as JSON, with the bracket form as fallback |
| `"Customer"` (other non-empty string) | One name |
| Anything else, or an empty string | `[]` |

A caller needs exactly one recognized group. A user in both groups, or in none, gets `403`. `test/jwt-claims.fixture.json` holds a claims example in this form.

## Adding a handler (T-09, T-10)

Handlers are registered through `deps.handlers` in `middleware/middleware.ts`. It is an object keyed by route key, and each value is a `RouteHandler`:

```ts
type RouteHandler = (ctx: {
  caller: { sub: string; group: 'Customer' | 'Adjuster'; tenantId: string };
  requestId: string;
  pathParameters: Record<string, string>;
  body: unknown; // validated against the route schema, undefined when the route has no body
}) => Promise<{ statusCode: number; body: unknown }>;
```

The handler runs after every check, so it can rely on a verified caller, an allowed group, valid path parameters and a valid body. The middleware serializes the result and adds the headers. A thrown error becomes `500`.

To register one, build the handlers in the entry point (`api-customer/index.ts` or `api-adjuster/index.ts`) and add them to `deps`. The handler code belongs in its own folder under `backend/api/`.

## Adding a route

1. Add a row to `ROUTES` in `routes.ts` and to `API_ROUTES` in `infra/lib/constructs/platform/api-model.ts`.
2. For a body, add the schema to `contracts/api` first (separate PR) and compile it in `middleware/schemas.ts`.
3. Update the stack tests under `infra/test/` that count routes, and the route table above.

## Bundling

The `ClaimsFunction` construct in `infra/lib/stacks/api-stack.ts` bundles each entry point with esbuild (`backend/api/api-customer/index.ts` and `backend/api/api-adjuster/index.ts`). Runtime Node.js 22, ARM64, timeout 10 s, memory 256 MB. Schemas compile once at module load. `cold-start.test.ts` bundles both entry points and checks a size ceiling.

The code creates no AWS SDK client. The functions have no table, bucket or queue permission, and their roles allow only their log group and X-Ray. Logs and metrics use Powertools (namespace `ClaimsAgent`, metric `ApiRequestOutcome` with an `outcome` dimension).

## Tests

```bash
npx vitest run backend/api
npm run typecheck -w backend/api
```

Property tests (`*.property.test.ts`) cover the group parser, caller identity, the group gate, body and path validation, size limits, the response envelope and log redaction. `test/helpers.ts` builds payload 2.0 events for tests.
