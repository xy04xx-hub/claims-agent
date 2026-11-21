# T-21: Console skeleton: auth, routing by role, API client

| Field | Value |
|---|---|
| Owner | B |
| Milestone | M1 |
| Depends on | T-06, T-07 |
| Judging items | SEC1, SEC2 |
| Estimate | 3 h |
| Status | Todo |
| Branch | `b/T-21-console-skeleton` |

## Why

The base every screen builds on.

## Tasks

- [ ] `frontend/`: React + Vite + TypeScript. Config from `.env.<stage>` written by `npm run outputs`.
- [ ] Sign-in with Cognito managed login (authorization code with PKCE). Keep tokens in memory, refresh with the refresh token. Send the **access token** as `Authorization: Bearer`.
- [ ] Routing by `cognito:groups`: Customer home vs Adjuster queue. Hide links the user cannot use (the API still enforces it).
- [ ] Typed API client generated from or checked against `contracts/api`.
- [ ] Minimal pages for M1: claim status page that polls `GET /claims/{id}` (500 ms for 10 s, then 2 s).

## Acceptance criteria

- [ ] Customer and adjuster land on their own home pages.
- [ ] No token is stored in `localStorage`.

## Verification

- [ ] Run `npm run dev -w frontend`, sign in as each user.
- [ ] Check Application storage in browser dev tools: no tokens.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
