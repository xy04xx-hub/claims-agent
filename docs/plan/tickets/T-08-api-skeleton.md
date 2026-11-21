# T-08: API stack: HTTP API, JWT authorizer, API Lambdas, validation

| Field | Value |
|---|---|
| Owner | B |
| Milestone | M1 |
| Depends on | T-06 |
| Judging items | SEC1, SEC2, SEC5, OE2 |
| Estimate | 3 h |
| Status | Todo |
| Branch | `<A|B>/T-08-api-skeleton` |

## Why

Every route authenticated, every body validated, role and tenant taken only from verified claims.

## Tasks

- [ ] HTTP API with a JWT authorizer (issuer = user pool, audience = console app client ID). No route without it. Stage throttling (for example 20 rps, burst 40).
- [ ] Two Lambdas with separate roles: `api-customer` and `api-adjuster`. A shared middleware reads `sub`, `cognito:groups`, `tenantId` from `event.requestContext.authorizer.jwt.claims`, rejects the wrong group with 403, and validates the body against the `contracts/api` schema (400 with field errors).
- [ ] Powertools logger with `requestId`, metrics namespace `ClaimsAgent`.
- [ ] All routes from `architecture.md` registered. Routes not yet built return 501.
- [ ] Unit tests: a customer token on an adjuster route gets 403; a body with an extra or oversized field gets 400; tenant in the body is ignored.

## Acceptance criteria

- [ ] Unauthenticated call returns 401. Wrong group returns 403. Invalid body returns 400.
- [ ] No handler reads role or tenant from the body or query string.

## Verification

- [ ] `curl https://<api>/me/policies` without a token returns 401.
- [ ] With a customer token, `curl https://<api>/queue` returns 403.
- [ ] `vitest run backend/api` passes.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
