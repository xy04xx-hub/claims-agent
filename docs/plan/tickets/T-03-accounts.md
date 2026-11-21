# T-03: Account readiness in both accounts, choose demo account

| Field | Value |
|---|---|
| Owner | A + B (each in own account) |
| Milestone | M0 |
| Depends on | none |
| Judging items | OE1, COST4 |
| Estimate | 1 h |
| Status | Todo |
| Branch | `a/T-03-accounts` or `b/T-03-accounts` (whoever leads) |

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

Results for the account below, us-east-1, run 2026-11-21. Only this account was checked.

1. Account ID: `116493205383` (`aws sts get-caller-identity`, role `WSParticipantRole`).
2. `cdk bootstrap aws://116493205383/us-east-1`: succeeded, CDKToolkit stack 12/12 resources created.
3. Bedrock Converse: **failed for both profiles.**
   - `global.anthropic.claude-haiku-5-5`: AccessDeniedException, explicit deny on `bedrock:InvokeModel` in identity policy `ws-bedrock-model-allowlist-policy-1`.
   - `us.anthropic.claude-haiku-5-5`: same error.
   - Neither works yet. The account's model allowlist policy must be changed by the organizers before Haiku 5.5 can be used. Not worked around.
4. `aws bedrock-agentcore-control list-gateways`: API responds, returns `{"items": []}`.
5. Quotas:
   - Lambda concurrent executions: 400.
   - Bedrock tokens per minute, Haiku 5.5: 10,000,000 for both the cross-region and the global cross-region profile.
   - Not checked: Docker in the IDE.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
