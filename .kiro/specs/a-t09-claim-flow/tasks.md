# Implementation Plan: a-t09-claim-flow

## Overview

Language: TypeScript (Node.js 22, CDK). Tasks are ordered for speed: Decision route mode and keys, config, API handlers with the additive ApiStack edit and updated T-08 tests, queue and DLQ, Worker (S3 evidence read, image and document blocks, `submit_proposal`), ProcessingStack, minimal tests, checkpoint, e2e script, deploy to `dev-a`, seed, run scenarios A and H, then docs and PR notes.

Work happens on the checked-out branch `a/T-09-15-19-claim-flow`. Files owned by B are edited in place and listed in the PR notes (task 11.2). No property tests and no README tests. The tests in task 7 are the minimal set from Requirement 13 and are not optional.

## Starting point

T-08 branch `origin/b/T-08-api-skeleton` is already merged into this branch and `npm test` passed (999 tests). Nothing to merge or re-run before starting.

## Tasks

- [x] 1. Decision route mode and keys
  - [x] 1.1 Add `queuePkForShard` and evidence `processingStatus`
    - In `backend/processing/decision/keys.ts` add `queuePkForShard(tenantId, status, shard)` and make `queuePk` call it.
    - Add `processingStatus?: "READY" | "PENDING" | "FAILED"` to `EvidenceRecord` in `types.ts`, computed in `normalize.ts` `toEvidenceRecord` from the hash rows (FAILED if any SHA256 or PHASH row is FAILED, READY if a SHA256 row is READY, else PENDING).
    - _Requirements: 7.4, 10.1_

  - [x] 1.2 Add Decision Lambda route mode
    - Add optional `route?: "EVIDENCE_NOT_READY" | "AUTOMATIC_CHECK_UNAVAILABLE"` to `DecideEvent` and accept it in `parseEvent` (proposal optional only when `route` is set; reject other values).
    - In `handlers.ts` skip `decideClaim` and `evaluate` when `route` is set. Use `failSafeDecision` or `routedDecision` with fixed text from a table, then the same conditional commit, audit and metrics. Route mode never produces `AUTO_APPROVED`.
    - No `contracts/` change, so `contracts/VERSION` stays.
    - _Requirements: 7.5, 8.7, 8.11, 8.14, 9.1, 9.4_

- [x] 2. Config
  - [x] 2.1 Stage config and seed override
    - `infra/lib/stage-config.ts`: add optional validated `injectBedrockFailure: boolean`.
    - `infra/config/dev-a.json`: set `enableVerificationClient: true`; confirm `bedrockModelId` is `global.anthropic.claude-haiku-4-5-20251001-v1:0` and `maxTokens` is set. Keep the `demo` guard.
    - `seed/definitions/constants.ts`: customer ID becomes `process.env.SEED_CUSTOMER_ID ?? "cust-demo"`.
    - _Requirements: 8.2, 8.3, 8.15, 12.2, 13.11_

- [x] 3. API handlers, ApiStack additive edit, T-08 test updates
  - [x] 3.1 Widen route state type and add 409 handling
    - Widen `RouteState` in `infra/lib/constructs/platform/api-model.ts` and the `state` field type in `backend/api/routes.ts` to `'NOT_IMPLEMENTED' | 'IMPLEMENTED'`. Set `IMPLEMENTED` for the seven routes in scope; `GET /impact` and `GET /claims/{claimId}/evidence/{evidenceId}` stay `NOT_IMPLEMENTED`. Keep both files equal.
    - Add `'CONFLICT'` to the `ErrorCode` union in `backend/api/middleware/errors.ts` and map status 409 to it (`error.response.schema.json` already lists `CONFLICT`, no contract change). Add the matching `Outcome` in `middleware/types.ts` if the pipeline needs one.
    - Add a `fail(status, code, message, fields?)` helper that returns a body matching `error.response.schema.json`.
    - _Requirements: 1.1, 10.5_

  - [x] 3.2 Shared repository
    - Create `backend/api/shared/repo.ts` wrapping the DynamoDB document client, reusing `DynamoStore` (`getClaim`, `getPolicyVersions`, `getPack`, `getEvidence`) and `keys.ts` by relative import. Add only what the API needs (policy query by customer, claim put and conditional update, byCustomer and byQueue queries, UPLOAD row put and get, resolution transaction).
    - _Requirements: 1.2, 3.4, 4.7_

  - [x] 3.3 Customer handlers: uploads and policies
    - `backend/api/api-customer/evidence-uploads.ts`: `EVD-<uuid>` IDs, key `tenantId/customerId/evidenceId`, `createPresignedPost` (type allow-list, content-length 1 to 5 MB, 300 s expiry), conditional UPLOAD row in EvidenceIndex.
    - `backend/api/api-customer/me-policies.ts`: active policies for the caller, highest version per `policyId`, covered causes intersected with the latest pack, required evidence per cause.
    - Add `@aws-sdk/s3-presigned-post` to `backend/api` only.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.4 Customer handlers: claims
    - `claims-create.ts`: ownership checks (policy, item, evidence → 403), policy version by loss date, deterministic `claimId`, conditional put, job message `{ tenantId, claimId, attempt: 1, requestId }` validated against `job-message.schema.json`, `enqueuedAt` update, `202`. Send failure throws (generic 500) and keeps the claim.
    - `claims-get.ts`: Customer own claim only (404 otherwise), Adjuster tenant claim with internal signals.
    - `claims-list.ts`: byCustomer, newest first, cursor bound to the caller's partition.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 3.5 Adjuster handlers
    - `backend/api/api-adjuster/queue.ts`: parallel query of `QUEUE_SHARDS` partitions with `queuePkForShard`, merge oldest first, 25 per page, `nextCursor`.
    - `resolution.ts`: 404 if missing, 409 if not `ROUTED_TO_ADJUSTER`, then one `TransactWriteItems` (conditional claim update removing `gsi2pk` and `gsi2sk`, audit record without the note). A cancelled transaction maps to 409 through the `CONFLICT` code from 3.1.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [x] 3.6 Register handlers in the entry points
    - `backend/api/api-customer/handlers.ts` and `backend/api/api-adjuster/handlers.ts` build the route-key maps (`createCustomerHandlers`, `createAdjusterHandlers`) with injected dependencies.
    - Edit both `index.ts` files to create the AWS clients and pass `handlers` to `createHandler`.
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [x] 3.7 ApiStack additive edit
    - `infra/lib/stacks/api-stack.ts`: add the `foundation` prop, per-function environment variables, and explicit least-privilege `PolicyStatement`s for `api-customer` and `api-adjuster` (conditional `UpdateItem` by `dynamodb:Attributes`, S3 `PutObject` on `bucket/*/*/*`, KMS on the data key). No `grant*` helpers.
    - Add `AwsSolutions-IAM5` acknowledgements with reasons for the new wildcards.
    - `infra/lib/build-app.ts`: pass `foundation` to Api and `api` to Processing.
    - _Requirements: 1.4, 6.8, 6.9, 10.9_

  - [x] 3.8 Update T-08 tests
    - `infra/test/api-stack.test.ts`: `build()` passes a `FoundationStack`; replace the environment-keys assertion and the "logs and X-Ray only" test with the new least-privilege assertions (customer role has no `UpdateItem` without the `enqueuedAt` condition, adjuster role has no `sqs:` action, no Bedrock, ssm, cognito-idp or `iam:PassRole`, no `*` action). Extend the resource allow-list.
    - `backend/api/routes.test.ts`: replace "every route NOT_IMPLEMENTED" with the seven `IMPLEMENTED` and two `NOT_IMPLEMENTED` routes, and keep `routes.ts` equal to `api-model.ts`.
    - `middleware/middleware.test.ts`, `cold-start.test.ts`: production-entry cases expect 501 only for `GET /impact` and the evidence-download route. `errors.test.ts`: add `[409, 'CONFLICT']`.
    - `infra/test/api-readme.test.ts`: keep the `501` item for the two remaining routes.
    - _Requirements: 6.10_

- [x] 4. Queue and DLQ
  - [x] 4.1 Job queue, DLQ and alarm in ApiStack
    - Job queue: SSE-KMS with the data key, `enforceSSL`, visibility timeout 360 s, `maxReceiveCount` from config (3). DLQ: SSE-KMS, `enforceSSL`, 14-day retention, alarm `ApproximateNumberOfMessagesVisible > 0`.
    - Add `jobQueue` and `jobDlq` to `ApiResources`, outputs `JobQueueUrl` and `JobDlqUrl`, `JOB_QUEUE_URL` on `api-customer`, and `sqs:SendMessage` on the job queue only. Acknowledge `AwsSolutions-SQS3` for the DLQ.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

- [x] 5. Worker
  - [x] 5.1 Retry and prompt
    - `backend/processing/worker/retry.ts`: `withRetry` with 3 tries, full-jitter backoff capped at 4 s, retry only throttling, 5xx and timeouts.
    - `prompt.ts`: `SYSTEM_PROMPT`, `PROMPT_VERSION`, `buildAgentInput(claim, evidence, blocks)` with the `<untrusted_claimant_text>` delimiter (delimiter strings stripped from the text).
    - _Requirements: 8.8, 8.9, 8.13_

  - [x] 5.2 Evidence loader
    - `evidence.ts` `loadEvidenceBlocks`: S3 `GetObject` and a Converse `image` block for JPEG or PNG, `document` block for PDF, only when `sizeBytes` is at most `maxEvidenceImageBytes` (also re-check `Content-Length` after the read). Other items are listed as "not shown to the model: too large", "type not allowed" or "unreadable" and are not read. No evidence bytes in logs.
    - _Requirements: 7.6, 7.7, 7.8, 7.9_

  - [x] 5.3 Agent tools
    - `tools.ts`: in-process `lookup_policy`, `check_fraud_signals`, `verify_evidence` (empty input schemas, closure over the Worker context, model arguments ignored) and the `submit_proposal` spec (input schema from the model-supplied part of `proposal.schema.json`, never executed, writes nothing).
    - _Requirements: 8.4, 8.5, 8.12_

  - [x] 5.4 Agent loop
    - `agent.ts` `runAgent`: Converse loop of at most 4 turns, `maxTokens` and `temperature: 0`, parallel tool execution, stop on `submit_proposal` and return its input, `NO_PROPOSAL` on overrun, `injectFailure` throws on every call, `withRetry` around each Converse call.
    - _Requirements: 8.1, 8.3, 8.6, 8.7, 8.10, 8.13, 8.14, 8.15_

  - [x] 5.5 Worker handler and entry
    - `handler.ts` `createWorker(deps)`: pipeline `LoadClaim`, `WaitEvidence` (poll up to 5 s, then `route("EVIDENCE_NOT_READY")`), `BuildInput`, `Agent`, `ValidateProposal` (Worker sets `claimId`, `model`, `promptVersion`, `customerText`, validates with `validateProposal`), `Decision`. Route mode on any Bedrock, schema or overrun failure with success reported. Drop invalid jobs, skip final claims. Publish `StageLatencyMs` per stage and a total value, structured logs with `claimId` and `requestId`.
    - `index.ts`: clients, environment configuration, wiring.
    - _Requirements: 7.3, 7.4, 7.5, 7.10, 7.13, 8.7, 8.11, 8.14, 9.1, 9.5, 11.1, 11.2, 11.3, 11.4_

- [x] 6. ProcessingStack
  - [x] 6.1 Worker function and event source
    - `infra/lib/stacks/processing-stack.ts`: `ClaimsFunction` `worker` (timeout 60 s, 512 MB), environment variables, `EventSourceMapping` on `api.jobQueue` (batch size 1, max concurrency 5, report batch item failures).
    - Explicit statements: read-only DynamoDB on Claims, Policies, ClaimTypePacks, EvidenceIndex; `s3:GetObject` on `bucket/*/*/*`; SQS receive actions; KMS `Decrypt` and `DescribeKey`; `lambda:InvokeFunction` on the Decision Lambda; `bedrock:InvokeModel` on the one inference profile and the foundation model with the `bedrock:InferenceProfileArn` condition. No Audit table access. IAM5 acknowledgements with reasons.
    - _Requirements: 7.1, 7.2, 7.11, 7.12, 8.2, 8.16_

  - [x] 6.2 DLQ to Decision mapping
    - Second `EventSourceMapping` from `api.jobDlq` to the Decision function (batch 10, partial batch responses), plus SQS receive actions and KMS `Decrypt` on the Decision role.
    - _Requirements: 9.2, 9.3, 9.4_

- [x] 7. Minimal tests (Requirement 13 only)
  - [x] 7.1 Claim create tests
    - `backend/api/api-customer/claims-create.test.ts`: another customer's policy, item or evidence returns 403 and writes nothing; a repeated `clientRequestId` returns the same claim and sends one job message (and sends it on the repeat after a failed send).
    - _Requirements: 13.1, 13.2_

  - [x] 7.2 Claim get tests
    - `backend/api/api-customer/claims-get.test.ts`: another customer's claim returns 404; `token_use: "id"` through `handleRequest` returns 401.
    - _Requirements: 13.3_

  - [x] 7.3 Resolution test
    - `backend/api/api-adjuster/resolution.test.ts`: a second resolution returns 409 and leaves the first one.
    - _Requirements: 13.4_

  - [x] 7.4 Worker tests
    - `backend/processing/worker/worker.test.ts`: Bedrock failing 3 times leads to one Decision call with `route: "AUTOMATIC_CHECK_UNAVAILABLE"` and no throw; a model result that fails `proposal.schema.json` does the same.
    - _Requirements: 13.5, 13.6_

  - [x] 7.5 Image-block test
    - `backend/processing/worker/evidence.test.ts`: the Converse request holds an `image` block for a PNG at or under `maxEvidenceImageBytes`, and no image block and no `getObject` call for a file over the limit.
    - _Requirements: 13.13_

  - [x] 7.6 CDK assertion tests
    - `infra/test/api-stack.test.ts`: queue visibility 360, `maxReceiveCount` 3, DLQ retention 14 days, SSE-KMS and TLS-only policies, alarm threshold 0, JWT authorizer on every route.
    - `infra/test/processing-stack.test.ts`: Worker timeout 60, mapping batch size 1, max concurrency 5, partial batch responses, Bedrock permission scoped to one inference profile with no `*` action.
    - _Requirements: 13.7_

  - [x] 7.7 Decision route-mode test
    - In `backend/processing/decision` (`decision.test.ts` or a new `route-mode.test.ts`), assert that a `DecideEvent` with `route` set to `"EVIDENCE_NOT_READY"` or `"AUTOMATIC_CHECK_UNAVAILABLE"` never yields `AUTO_APPROVED`, even when the claim, policy and signals would otherwise approve and the kill switch is on.
    - Assert that it commits `ROUTED_TO_ADJUSTER` with the fixed reason text for that route.
    - Assert that an unknown `route` value, and a missing `proposal` without `route`, are rejected.
    - This is the test required by the security rule that any approval logic change needs a test showing the model cannot cause approval.
    - _Requirements: 9.1, 9.4_

- [x] 8. Checkpoint - Ensure all tests pass
  - Run `npm run lint`, `npm run typecheck`, `npm test` and `npx cdk synth -c stage=ci`. Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 13.8_

- [x] 9. E2E script
  - [x] 9.1 `scripts/e2e-claim-flow.ts`
    - Usage `npx tsx scripts/e2e-claim-flow.ts --stage dev-a [--identifier-fallback] [--cleanup]`. Read stack outputs and `E2E_CUSTOMER_EMAIL` / `E2E_CUSTOMER_PASSWORD`; missing stage, output or variable exits non-zero naming the item.
    - Per scenario (A, H): sign in (access token never printed), `GET /me/policies` (empty exits non-zero naming `SEED_CUSTOMER_ID`), `POST /evidence/uploads`, presigned POST upload, `POST /claims` twice with the same `clientRequestId` (report same `claimId`), poll (500 ms for 10 s, then 2 s up to 20 s).
    - `--identifier-fallback`: write an EvidenceIndex `IDENTIFIER` row with the developer's AWS credentials and print that it is a stand-in for image reading. Default writes none.
    - Verdict: A passes on `AUTO_APPROVED` with payout 130 within 10 s; H passes on `ROUTED_TO_ADJUSTER` with `decision.reasons.adjuster` (read with AWS credentials) naming `CLM-1042`. Print elapsed time and status, exit 1 on any failure. `--cleanup` deletes the claims of the run.
    - _Requirements: 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9_

- [x] 10. Deploy, seed, run scenarios
  - [x] 10.1 Deploy all stacks to dev-a
    - Run `npx cdk deploy --all -c stage=dev-a` from `infra/` and record the outputs (`ApiUrl`, queue URLs, `VerificationClientId`). Fix any deploy error in code, not in the console.
    - _Requirements: 12.1_

  - [x] 10.2 Seed users and seed data
    - Run `scripts/seed-users.ts` for `dev-a`, take the `sub` of `customer1@example.com`, then run the seed with `SEED_CUSTOMER_ID=<sub>`. Verify `GET /me/policies` returns a policy.
    - _Requirements: 12.2_

  - [x] 10.3 Run scenarios A and H and show results
    - Run the e2e script for `dev-a` (add `--identifier-fallback` only if image reading fails) and show the output to the user: per-scenario elapsed time, final status, A payout, H reason naming `CLM-1042`, and the duplicate-submit check.
    - _Requirements: 12.3, 12.4, 12.5, 12.6, 12.8_

- [x] 12. Audit reason code fix (found in the dev-a run)
  - [x] 12.1 Use the routing signal as the audit reasonCode
    - In `backend/processing/decision`, when a claim is routed because the `NO_RISK_SIGNALS` check failed, set the audit record `reasonCode` to the code of the first risk signal that caused the routing (for example `IDENTIFIER_REUSE`, `DUPLICATE_PHOTO`) instead of the check name `NO_RISK_SIGNALS`. Keep `checksFailed` unchanged. Other failed checks keep their current `reasonCode`. The value must still validate against `contracts/audit-record.schema.json`: check the allowed values, and if the schema restricts `reasonCode` and lacks the signal codes, stop and report instead of changing the contract. The routed-by-reason metric dimension uses the same value if it currently uses the check name.
    - Add one unit test: an `IDENTIFIER_REUSE` claim produces `reasonCode` `IDENTIFIER_REUSE` in the audit record, and the outcome is still `ROUTED_TO_ADJUSTER`.
    - Run the decision workspace tests and typecheck. Deploy only the Processing stack to dev-a (`npx cdk deploy ClaimsAgent-dev-a-Processing -c stage=dev-a` from `infra/`, exclusively). Stop and report on deploy failure.
    - Commit as `fix(T-14): use routing signal as audit reason code` with only the changed files, and push the current branch `a/T-09-15-19-claim-flow` to origin (plain push, no force).
    - _Requirements: 11.2, 9.1_

- [ ] 11. Docs and PR notes (deferred by the user)
  - [ ]* 11.1 READMEs and ticket status
    - Update `backend/api/README.md`, `backend/processing/README.md` and `scripts/README.md` (usage, "Implemented by" status, the claim-frequency note and `--cleanup`). Update the status of tickets T-09, T-10 and T-15.
    - _Requirements: 13.10, 13.12_

  - [ ]* 11.2 PR notes
    - Write the PR description: list every B-owned file edited, mark `GET /me/policies`, `GET /queue` and the resolution route as included from T-09 and T-10, and paste the dev-a e2e output. Confirm the gates from task 8 pass.
    - _Requirements: 13.8, 13.9_

## Notes

- Test tasks in section 7 are required by Requirement 13 and are not optional. No property tests are included.
- Section 11 (11.1 and 11.2) is deferred by the user. The tasks are optional (`*`) and are scheduled in the last waves, to be done at the end if time allows. They must not run with the required tasks.
- Tasks 10.1 to 10.3 run against a real account and need valid AWS credentials.
- Do not hand-edit `package-lock.json`; use `npm install -w backend/api` for the new dependency.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "3.2"] },
    { "id": 2, "tasks": ["3.3", "3.4", "3.5", "5.1", "5.2"] },
    { "id": 3, "tasks": ["3.6", "3.7", "5.3", "7.5"] },
    { "id": 4, "tasks": ["3.8", "4.1", "5.4"] },
    { "id": 5, "tasks": ["5.5", "7.1", "7.2", "7.3"] },
    { "id": 6, "tasks": ["6.1", "7.4", "7.7"] },
    { "id": 7, "tasks": ["6.2"] },
    { "id": 8, "tasks": ["7.6", "9.1"] },
    { "id": 9, "tasks": ["10.1"] },
    { "id": 10, "tasks": ["10.2"] },
    { "id": 11, "tasks": ["10.3"] },
    { "id": 12, "tasks": ["12.1"] },
    { "id": 13, "tasks": ["11.1"] },
    { "id": 14, "tasks": ["11.2"] }
  ]
}
```
