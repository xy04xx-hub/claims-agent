# Requirements: T-14 Decision Lambda

Source: `docs/plan/tickets/T-14-decision.md`. Scope is the ticket's scope. Contracts: `contracts/decision.schema.json`, `proposal.schema.json`, `audit-record.schema.json`, `job-message.schema.json`, `data-model.md`. Rules: `backend/domain`.

## User story
As the claims platform, I want one Lambda that alone can write a decision, so that a wrong or hostile proposal can never cause an approval.

## Requirements (EARS)

1. THE SYSTEM SHALL deploy the Decision Lambda in the Processing stack with two entry points: `decide` (input `{tenantId, claimId, proposal}`) and `routeOnly` (SQS DLQ event).
2. WHEN `decide` is invoked, THE SYSTEM SHALL re-fetch the policy version in force on the loss date, the claim type pack, the evidence index entries and the claim history from DynamoDB, and SHALL pass them to `domain.decide`.
3. WHEN the proposal is used, THE SYSTEM SHALL read only its extracted fields and re-check them against the system of record.
4. IF the proposal does not validate against `proposal.schema.json`, THEN THE SYSTEM SHALL route the claim to an adjuster.
5. WHEN `autoApproveEnabled` is read from SSM, THE SYSTEM SHALL cache it for at most 60 seconds.
6. IF `autoApproveEnabled` is `false`, THEN THE SYSTEM SHALL route every claim.
7. WHEN a decision is written, THE SYSTEM SHALL update the claim only if its status is `PROCESSING`, so a claim is decided once.
8. IF a second decision is attempted for the same claim, THEN THE SYSTEM SHALL reject it and leave the first decision unchanged.
9. WHEN a decision is written, THE SYSTEM SHALL write the audit record in the same transaction: inputs, policy and pack version, thresholds in force, checks, signals, outcome, actor `agent`, model and prompt version, and ticket `jti` when present. It SHALL NOT store photo bytes or full personal data.
10. WHEN `routeOnly` is invoked with a standard SQS event (`Records[].body` holding a job message), THE SYSTEM SHALL always route the claim, with reason `AUTOMATIC_CHECK_UNAVAILABLE`, and mark it fail-safe. Verification invokes it directly with a sample SQS event, because the DLQ comes in T-09. The event shape stays the real SQS one, so T-09 can wire the DLQ with no handler change.
11. IF a lookup, an SSM read or any other step fails in `decide`, THEN THE SYSTEM SHALL route the claim (never approve).
12. WHEN a claim is decided, THE SYSTEM SHALL emit EMF metrics `AutoApproved`, `Routed` (dimension `reason`), `FailSafeRouted` and `DecisionLatencyMs`.
13. THE SYSTEM SHALL give the Lambda a dedicated role that can: read Policies, ClaimTypePacks, EvidenceIndex; read and update Claims; put AuditLog; read the one SSM parameter `autoApproveEnabled`; use the data key. Nothing else.
14. THE SYSTEM SHALL ensure that only this Lambda's role has `UpdateItem` on the Claims table for final statuses, shown in the synthesized template.
15. WHEN the T-11 never-approve rules are run against the handler with a hostile proposal, THE SYSTEM SHALL still route.

## Out of scope (MVP)
CI workflow changes and dedicated cdk-nag work. The DLQ and its event source mapping (T-09, T-15). Verification does not use a real DLQ. Tool Lambdas and the agent.
