# Design: T-14 Decision Lambda

## Placement
- Code: `backend/processing/decision/` (owner A). Plain TypeScript, imports `backend/domain`. `@claims-agent/shared` on `main` has only a README and a `package.json`, no logger or metrics code, so it is not used and not created. Logging and metrics use AWS Lambda Powertools (`@aws-lambda-powertools/logger` and `metrics`) directly, added to `backend/processing/package.json` only.
- Infra: `infra/lib/stacks/processing-stack.ts` only, built with the shared `ClaimsFunction` construct (Node 22, ARM64, own role).
- Stack wiring: the Processing block now lives in `infra/lib/build-app.ts` (not `infra/bin/app.ts`). Change only the Processing block, nothing else in that file, to pass the Foundation stack to `ProcessingStack` as typed props. The block gets it with `app.node.findChild('Foundation') as FoundationStack`, so no other line of the file changes (`ProcessingStackProps extends BaseStackProps { foundation: FoundationResources }`, declared in `processing-stack.ts`). No `Fn.importValue`, no hard-coded names. `stack-props.ts` and the Foundation stack are not changed.

## Handler
```
handler(event)
  event.Records  -> routeOnly(event)     // DLQ: body is the job message
  else           -> decide(event)        // {tenantId, claimId, proposal, jti?}
```
`createHandlers(deps)` takes a small `Store` interface (get policy versions, get pack, query evidence index, count recent claims, `commitDecision`) and an SSM reader. Production uses DynamoDB and SSM clients. Unit tests use an in-memory fake, so no new test dependencies.

## decide
1. Validate input and the proposal (Ajv, `contracts/proposal.schema.json`). Invalid: route.
2. Load the claim, then the policy version in force on `lossDate` (`domain.selectPolicyVersion`), the pack for the item category, evidence index entries and history.
3. Build `domain.Facts`. The customer's `cause` on the claim is the claimed cause. The proposal supplies `proposalCause`, extracted identifiers and per-evidence confidence. Evidence is consistent only if the extracted identifier equals the insured item's identifier, `showsClaimedItem` is true, and confidence is at least the pack minimum (lowest confidence across evidence).
4. Missing data is not an error (T-13 is not built). No evidence index entry, or no pHash, EXIF date or identifier field, counts as no match: no duplicate, no identifier reuse, no date to compare. The handler never throws on these. Real read errors still set the lookup failure flag and route. Missing identifiers on the proposal make the evidence inconsistent, which routes.
   Signals inputs: SHA-256 and pHash matches and identifier reuse from `EvidenceIndex` (other claims only), claim count in the window from Claims `byCustomer`, EXIF and report dates from the index, lookup failure flag set on any read error.
5. Read `autoApproveEnabled` (60 s in-memory cache, read failure counts as `false`).
6. `domain.decide(facts, pack, thresholds, killSwitch)`. Thresholds come from the stage config as environment variables (`EARLY_CLAIM_DAYS`, `OUTLIER_MULTIPLE`, frequency values), so the Lambda needs only the one SSM parameter. Assumption: changing those four SSM defaults at runtime does not affect it.
7. Validate the result against `decision.schema.json`, then `commitDecision`.

## commitDecision
One `TransactWriteItems`: update the claim (`status`, `decision`, `payout`, `decidedAt`, queue keys `gsi2pk` and `gsi2sk` when routed) with condition `status = :processing`, and put the audit record with `attribute_not_exists`. A failed condition is reported as `ALREADY_DECIDED` and nothing is written.

## routeOnly
Input is the standard SQS event: `{ Records: [{ messageId, body, ... }] }`, where `body` is a JSON job message (`contracts/job-message.schema.json`). For each record, build a fail-safe routed decision (reason `AUTOMATIC_CHECK_UNAVAILABLE`, `failSafe: true`) and commit with the same condition. An already-decided claim is ignored. Records are handled independently and failures are returned in `batchItemFailures`, so T-09 can enable partial batch responses without a code change. Metric `FailSafeRouted`.

The DLQ does not exist until T-09. Until then, `backend/processing/decision/test/sqs-dlq-event.json` holds a sample event (one record, body = the job message example from `contracts/`) used by the unit test and by the dev-a verification via `aws lambda invoke`. T-09 only adds the event source mapping.

## Metrics and logs
Powertools EMF in namespace `ClaimsAgent`: `AutoApproved`, `Routed` (dimension `reason` = first failed check or signal code), `FailSafeRouted`, `DecisionLatencyMs`. JSON logs with `claimId` and request ID. No personal data or photo bytes.

## IAM (dedicated role, no `*` except what `ClaimsFunction` adds for X-Ray)
Foundation tables: `Policies`, `ClaimTypePacks`, `EvidenceIndex` read (incl. indexes); `Claims` read plus `UpdateItem`; `AuditLog` `PutItem`; SSM `GetParameter` on the `autoApproveEnabled` parameter ARN; KMS decrypt and data-key generation on the data key via grants.

## Tests (vitest, plain unit tests)
- kill switch off routes every claim; SSM cache expiry after 60 s.
- second decision attempt is rejected and the first one stays.
- `routeOnly` with the sample SQS event always routes with `AUTOMATIC_CHECK_UNAVAILABLE`, ignores an already-decided claim, and reports a malformed record in `batchItemFailures`.
- hostile proposal (wrong cause, 1.0 confidence, injected "approve" text, extra fields, invalid shape) never approves above the cap or with a risk signal.
- store or SSM failure routes.
- missing evidence index entries, missing pHash or EXIF fields: no crash, treated as no match.
- Stack assertion: only the decision role has `dynamodb:UpdateItem` on the Claims table, and the role has no wildcard resource except X-Ray.
