# Tasks: T-14 Decision Lambda

Each task is one commit (`feat(T-14): <task>`). Branch `a/T-14-decision`. Do not edit `contracts/`, `backend/domain`, Foundation or `claims-function.ts`. If a contract gap appears, change the contract in its own PR first.

- [x] 1. Scaffold `backend/processing/decision/` (`index.ts`, `Store` interface, handler dispatch between `decide` and `routeOnly`). Add Powertools logger and metrics to `backend/processing/package.json`. Do not create or use `@claims-agent/shared`
- [x] 2. DynamoDB `Store`: policy versions, pack, evidence index lookups, claim history count, claim read. Missing index entries or missing pHash, EXIF or identifier fields return "no match" and never throw
- [x] 3. SSM reader for `autoApproveEnabled` with a 60 s cache; read failure counts as off
- [x] 4. `decide`: validate input and proposal, build `domain.Facts`, call `domain.decide`, validate the result against `decision.schema.json`
- [x] 5. `commitDecision`: one transaction (conditional claim update from `PROCESSING` plus audit put), `ALREADY_DECIDED` handling
- [x] 6. Audit record from `audit-record.schema.json` (policy and pack version, thresholds, checks, signals, actor `agent`, model, prompt version, `jti`)
- [x] 7. `routeOnly` for SQS events (reason `AUTOMATIC_CHECK_UNAVAILABLE`, fail-safe, `batchItemFailures`) and the sample event `test/sqs-dlq-event.json`
- [x] 8. EMF metrics and structured logs with Powertools directly
- [x] 9. Unit tests: kill switch, cache expiry, second decision rejected, `routeOnly`, store failure routes, missing evidence index entries and missing pHash or EXIF fields do not crash and count as no match
- [x] 10. Unit test: T-11 never-approve rules through the handler with a hostile proposal
- [x] 11. Processing stack: decision function with the dedicated role and least-privilege grants, env vars from stage config, Foundation passed as typed props. In `infra/lib/build-app.ts` change only the Processing block: get the Foundation stack inside it with `app.node.findChild('Foundation') as FoundationStack`, so the Foundation line and the other blocks stay untouched
- [x] 12. Stack test: only the decision role has `UpdateItem` on Claims in the synthesized template; no wildcard resources except X-Ray
- [x] 13. Run `npm test -w backend/processing` (69 passed), the infra tests (221 passed) and `npm run typecheck` (clean)
- [ ] 14. Deploy and verify in `dev-a` (only Foundation and Processing):
  - `CDK_DEFAULT_ACCOUNT=<my account> npx cdk deploy ClaimsAgent-dev-a-Foundation ClaimsAgent-dev-a-Processing -c stage=dev-a` from `infra/` (no other stack).
  - Put minimal synthetic items (policy, pack, a `PROCESSING` claim with evidence index entries) with the T-12 seed if it exists, otherwise `aws dynamodb put-item`.
  - Happy path: `aws lambda invoke` the `decide` entry with a clean proposal. Expect `AUTO_APPROVED`, claim updated, audit record present.
  - Second invoke for the same claim: rejected, claim unchanged.
  - Kill switch: `aws ssm put-parameter --overwrite` `/claims/dev-a/autoApproveEnabled` to `false`. Within 60 s a new claim invoke is `ROUTED_TO_ADJUSTER` with `AUTO_APPROVE_ENABLED` failed. Set it back to `true`.
  - routeOnly: no DLQ exists yet (T-09). `aws lambda invoke` the Lambda with `test/sqs-dlq-event.json` (real SQS shape, `body` = job message for a `PROCESSING` claim). Expect the claim routed with reason `AUTOMATIC_CHECK_UNAVAILABLE` and `FailSafeRouted` emitted. T-09 later adds the event source mapping only.
  - Check `Routed`, `AutoApproved` and `FailSafeRouted` appear in CloudWatch metrics and the logs hold no personal data.
  - Record the results in the PR. Leave the stack deployed or destroy it, as agreed.
