# T-03: Account readiness in both accounts, choose demo account

| Field | Value |
|---|---|
| Owner | A + B (each in own account) |
| Milestone | M0 |
| Depends on | none |
| Judging items | OE1, COST4 |
| Estimate | 1 h |
| Status | Todo |
| Branch | `<A|B>/T-03-accounts` |

## Why

Each person deploys into a separate workshop account, so both must have the same services and quotas available before anyone builds on them.

## Tasks

- [ ] Each person, in their own account in us-east-1:
  - Record the account ID with `aws sts get-caller-identity`.
  - Run `npx cdk bootstrap aws://<account>/us-east-1`.
  - Confirm Bedrock access: a one-line Converse call to `global.anthropic.claude-haiku-5-5` (or `us.` profile) succeeds.
  - Confirm AgentCore Runtime and Gateway APIs respond (`aws bedrock-agentcore-control list-gateways`).
  - Note service quotas: Lambda concurrent executions, Bedrock tokens per minute for Haiku 5.5.
  - Confirm Docker works in the IDE (needed if the agent is a container image).
- [ ] Agree which account hosts `demo` (default: A's account `579813007466`). Record it in `docs/plan/README.md` section 2.
- [ ] Ask the organizers whether the team can share one account. If yes, switch both dev stages into that account and keep separate stage names.

## Acceptance criteria

- [ ] Both accounts bootstrapped, Bedrock call works, AgentCore API reachable.
- [ ] Quotas written down in this ticket.
- [ ] Demo account chosen.

## Verification

- [ ] Paste the outputs of the four checks into this ticket (no secrets).

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
