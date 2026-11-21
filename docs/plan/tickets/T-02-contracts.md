# T-02: Contracts: API, data, job, tools, proposal, decision, ticket

| Field | Value |
|---|---|
| Owner | A + B (A drafts, B reviews) |
| Milestone | M0 |
| Depends on | none |
| Judging items | SEC2, SEC5, BIZ-C |
| Estimate | 3 h |
| Status | Todo |
| Branch | `a/T-02-contracts` or `b/T-02-contracts` (whoever leads) |

## Why

The two halves meet at these interfaces. Agreeing on them first lets both people build in parallel against stubs.

## Tasks

- [ ] Create `contracts/` with JSON Schemas (draft 2020-12) and examples for each:
  - `api/*.json`: request and response bodies for every route in `architecture.md` (API section), with limits (string lengths, max 6 evidence IDs, file size up to 5 MB, content types JPEG, PNG, PDF).
  - `data-model.md`: every DynamoDB table with keys, GSIs, attributes and the access pattern each serves. Partition keys prefixed with `tenantId`. Include the sharded queue index `tenantId#status#shard`.
  - `job-message.json`: SQS body, IDs only: `tenantId`, `claimId`, `attempt`, `requestId`.
  - `tools/*.json`: input and output schema of `lookup_policy`, `check_fraud_signals`, `verify_evidence`. Inputs contain **no** claim or customer ID (the Interceptor injects them).
  - `proposal.json`: the agent's output: extracted fields (item category, cause from the fixed list or `UNCLEAR`, amount, loss date, identifiers), evidence assessment with confidence, draft customer text.
  - `decision.json`: outcome (`AUTO_APPROVED` or `ROUTED_TO_ADJUSTER`), checks passed and failed, risk signals, informational flags, reasons (customer text and adjuster text), payout.
  - `job-ticket.md`: JWS header and claims (`claimId`, `tenantId`, `attempt`, `jti`, `iat`, `exp`), algorithm ES256, header name used on MCP calls.
  - `audit-record.json`: fields from `architecture.md` (no photo bytes, no full personal data).
- [ ] Add a small validation helper and a unit test that every example validates against its schema.
- [ ] Version the contracts (`contracts/VERSION`). A change needs a PR approved by both.

## Acceptance criteria

- [ ] Every route, message, tool and record in `architecture.md` has a schema and an example.
- [ ] Schemas enforce the limits named in the security rules.
- [ ] Both people approved the PR.

## Verification

- [ ] `npm test -w contracts` passes (examples validate).
- [ ] Walk through scenarios A to N from the user-flow discussion and confirm every field needed exists.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
