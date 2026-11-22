# Status (2026-11-22, stage dev-a)

## URLs

- Console: https://dqgqnillqzhh8.cloudfront.net (CloudFront, private S3)
- API: https://3g0j89m0di.execute-api.us-east-1.amazonaws.com
- Logins: `docs/DEMO-CREDENTIALS.local.md` (git-ignored, local only)

## What works

- Claim flow end to end: presigned evidence upload, `POST /claims`, SQS, Worker with the Bedrock agent (Claude Haiku 4.5), Decision Lambda, audit record, status polling.
- Console (React + Vite + TypeScript, plain CSS): Cognito hosted UI sign-in (code with PKCE, tokens in memory, access token to the API). Customer screen: policies and items, claim form, evidence upload, status polling with decision, payout, message and passed checks, my claims. Adjuster screen: queue with reasons, evidence link, Approve and Reject.
- Console config comes from stack outputs at build time (`npm run outputs -- dev-a`).
- Audit `reasonCode` uses the routing signal (for example `IDENTIFIER_REUSE`), not the check name `NO_RISK_SIGNALS` (unit test in `backend/processing/decision/decision.test.ts`).

## Scenarios

| Scenario | Via | Result |
|---|---|---|
| A (phone damage, 180) | `scripts/e2e-claim-flow.ts` | PASS, AUTO_APPROVED, payout 130 |
| H (phone theft, IMEI already claimed on CLM-1042) | `scripts/e2e-claim-flow.ts` | PASS, ROUTED_TO_ADJUSTER, "Identifier ...0017 was already claimed on CLM-1042." |
| A, H, adjuster approves H | console, `tests/e2e/console-ui.mjs` (headless Chrome) | PASS: A approved, H routed, H approved by adjuster, queue 1 to 0 |
| Seed scenarios A to H, K | `scripts/run-scenarios.ts` | not re-run today |

## Latency (scenario A through the API, 5 warm runs, cleanup between runs, submit to final status)

| Run | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| ms | 6392 | 6838 | 5987 | 6956 | 8679 |

p50 6.8 s, max 8.7 s. An earlier batch (first run cold): 9263, 6211, 6441, 6161, 6058 ms, p50 6.2 s, max 9.3 s. The target is p50 about 4 s and p95 up to 6 s, so the happy path is above target. Most time is the two model turns in the Worker (about 5.7 s of Worker time). Levers: fewer tokens, one model turn (call the three read tools in code before the model call), smaller images.

## Fixes made today

- `GET /queue` returned 500 (DynamoDB rejects an empty sort-key value). The first page now starts at `"0"`.
- The model lowered its confidence below the 0.8 threshold because of the "SYNTHETIC SAMPLE" banner, so scenario A was routed. The worker prompt (version `worker-v2`) now defines confidence as legibility and says to use 0.9 or higher when the identifier is clearly legible. The decision code is unchanged: it still checks the IMEI, the cap and the signals itself.
- The model misread the IMEI on `police-report-phone2.png` (zero run: 867533090000017 instead of 867530900000017), which made scenario H route for a mismatch. The IMEI line on the police reports is now drawn at a larger scale (`seed/tools/generate-evidence.ts`) and the model reads it correctly.
- `infra/config/dev-a.json`: added the CloudFront origin to `consoleOrigins` (API and evidence bucket CORS). Foundation, Api, Processing and Web stacks were redeployed. No stack was destroyed.
- `scripts/cleanup-demo-data.ts`: removes claims filed through the API and their evidence rows, keeps seed data. Demo data is clean (no claim in PROCESSING, queue and DLQ empty) as of the last check.

## Known issues

- Latency above target (see above).
- The seed hashes of the three regenerated police report images in tenant `demo-insurer` (`CLM-SCN-*` rows) are stale until the seed is run again. Tenant `t1`, used by the console and e2e script, is not affected (CLM-1042 uses the unchanged phone photo). Re-seed before running `scripts/run-scenarios.ts`.
- The model reading of digits is a signal and can still be wrong (a wrong read routes the claim, it never approves).
- Tokens are in memory only: a page reload requires signing in again. No refresh token handling.
- Customer message for a routed claim is generic ("could not match your evidence") even when the reason is a reused identifier. The adjuster sees the specific reason.
- Prompt caching has no effect: the cached prefix is below the 4,096-token minimum for Haiku 4.5.
- The Agent stack's AgentCore Runtime, Gateway and Interceptor are not on the decision path. The agent loop runs in the Worker with in-process tools.
- No CloudWatch dashboard was found in `infra/lib` (logs and metrics are emitted).

## Skipped

- Console: claim detail with both duplicate photos side by side, upload progress bar, step-by-step progress view, refresh tokens, unit tests for the console, `GET /impact` panel.
- Reject reason selection (the console sends `OTHER` for Reject and `VERIFIED_OK` for Approve).
- `npm run lint` and the full test suite were run only on the changed workspaces (api: 150 tests, processing: 162 tests, seed and scripts: 97 tests, all passing).
- Scenarios B to G were not run through the deployed stack today.
