# T-06: Auth stack: Cognito, groups, tenant claim in access token

| Field | Value |
|---|---|
| Owner | B |
| Milestone | M1 |
| Depends on | T-05 |
| Judging items | SEC1, SEC2 |
| Estimate | 3 h |
| Status | Todo |
| Branch | `b/T-06-auth` |

## Why

Sign-in for both roles, and an access token that carries role and tenant so the API never trusts the request body.

## Tasks

- [ ] Cognito user pool, Essentials feature plan (needed to customize access tokens), email sign-in, strong password policy, self sign-up off (users are seeded).
- [ ] Groups `Customer` and `Adjuster`. Custom attribute `tenantId` (immutable, not writable by the app client).
- [ ] Pre token generation trigger **V2** (`ClaimsFunction`): adds `tenantId` to the **access token** from the user's attribute. This closes a gap: custom attributes are not in access tokens by default. Record this as a small addition to `architecture.md` (Cognito row) in the PR.
- [ ] App client for the console: public client (no secret), authorization code with PKCE through managed login, access token validity 60 min, refresh token 1 day, callback and logout URLs from the Web stack output and `http://localhost:5173` for local dev.
- [ ] Script `scripts/seed-users.ts`: creates synthetic users `customer1`, `customer2`, `adjuster1` with the tenant and group, temporary passwords printed once to the terminal (never committed).

## Acceptance criteria

- [ ] Signing in as each seeded user returns an access token containing `cognito:groups`, `tenantId` and `client_id`.
- [ ] No user can change their own `tenantId`.

## Verification

- [ ] Sign in via managed login, decode the access token (for example in the browser dev tools) and check the three claims.
- [ ] `aws cognito-idp update-user-attributes` with the user's own token on `custom:tenantId` fails.

## Notes

Cognito Essentials is billed per monthly active user, already in `docs/cost-estimate.md`.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
