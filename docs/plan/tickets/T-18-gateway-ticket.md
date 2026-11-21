# T-18: Gateway (IAM), Interceptor, KMS job ticket

| Field | Value |
|---|---|
| Owner | A |
| Milestone | M3 |
| Depends on | T-16, T-17 |
| Judging items | SEC3, SEC5, SEC2 |
| Estimate | 5 h |
| Status | Todo |
| Branch | `<A|B>/T-18-gateway-ticket` |

## Why

Implements the credentials design: no token passthrough, IAM to the gateway, and every tool call bound to one claim.

## Tasks

- [ ] Asymmetric KMS key `ECC_NIST_P256` (`SIGN_VERIFY`). Worker role: `kms:Sign` on this key only. Interceptor gets the public key once (`kms:GetPublicKey`) and verifies locally.
- [ ] Worker: sign a compact JWS (ES256) with `claimId`, `tenantId`, `attempt`, `jti`, `iat`, `exp = iat + 60 s` for each attempt.
- [ ] AgentCore Gateway: inbound `AWS_IAM`. Only the Runtime execution role has `bedrock-agentcore:InvokeGateway` on this gateway ARN. Targets: the three tool Lambdas with the gateway service role, limited to `lambda:InvokeFunction` on them.
- [ ] REQUEST interceptor Lambda (headers passed through): verify signature and `exp`, check the claim is `PROCESSING` and the tenant matches, then overwrite `claimId` and `tenantId` in the tool arguments. Reject otherwise. Log `jti`.
- [ ] **Required tests (steering rule):** missing, expired, wrongly signed, other-claim and other-tenant tickets are rejected; a tool argument naming another claim is overwritten; a call to the gateway from any other role is denied; a user access token sent to the gateway is rejected.
- [ ] Update `architecture.md` if anything differs from the design.

## Acceptance criteria

- [ ] All required tests pass (unit tests for the interceptor, deployed checks for IAM).
- [ ] cdk-nag clean.

## Verification

- [ ] From the IDE with your workshop role (not the Runtime role), call the gateway: denied.
- [ ] Call the gateway with a Cognito access token: rejected.
- [ ] Replay a ticket after 60 s: rejected, logged.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
