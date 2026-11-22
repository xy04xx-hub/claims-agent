# backend/auth
Owner: B (muzair110)

## Purpose

Cognito pre token generation trigger (event version `V2_0`). It adds the claim `tenantId` to the access token, so the API can read the tenant from the verified token and never from the request body.

## Claim mapping

| Item | Value |
|---|---|
| Source | `request.userAttributes["custom:tenantId"]` |
| Target | `response.claimsAndScopeOverrideDetails.accessTokenGeneration.claimsToAddOrOverride.tenantId` |
| Allowed value | `^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$` |
| `request.clientMetadata` | Never read, because the client controls it |
| Missing or invalid tenant | The handler throws `InvalidTenantError`, so Cognito issues no token. The message does not contain the value |
| Other event members | Unchanged. Existing claims and scopes in the response are kept |

## Files

- `pre-token-generation/claim-mapping.ts`: pure function `addTenantClaim` and `InvalidTenantError`.
- `pre-token-generation/index.ts`: the Lambda handler. It calls the mapper, writes one log line and rethrows on failure.
- `pre-token-generation/claim-mapping.property.test.ts`: property tests for the mapper (more test files are added in the same folder).

## Bundling

The `ClaimsFunction` construct in `infra/lib/stacks/auth-stack.ts` bundles the handler with esbuild. Runtime Node.js 22, ARM64, timeout 5 s, memory 256 MB. The function makes no AWS SDK call, has no environment variables beyond the two standard ones, and its role allows only its log group and X-Ray.

## Logging

One JSON line per invocation with the trigger source, client ID, outcome and request ID. It never logs the email address, the attribute map or the tenant value.

## Tests

```bash
npx vitest run backend/auth
npm run typecheck -w backend/auth
```
