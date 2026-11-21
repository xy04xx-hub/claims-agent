# T-16: Spike: AgentCore in CDK, agent language (timebox 3 h)

| Field | Value |
|---|---|
| Owner | A |
| Milestone | M2 |
| Depends on | T-04 |
| Judging items | OE1, SEC3 |
| Estimate | 3 h |
| Status | Todo |
| Branch | `<A|B>/T-16-agentcore-spike` |

## Why

AgentCore is the least familiar part. Prove the pieces work in CDK before building on them.

## Tasks

- [ ] Check the `aws-cdk-lib.aws_bedrockagentcore` L2 constructs (Runtime, Gateway, GatewayTarget) and, if needed, the L1 `Cfn*` resources or the alpha package, for: Gateway inbound authorizer `AWS_IAM`, Lambda targets with the gateway service role, a REQUEST interceptor Lambda with request headers passed through, Runtime with IAM inbound auth, Runtime artifact (container image from a `DockerImageAsset`, or direct code deployment if available).
- [ ] Deploy a throwaway `hello` runtime that calls one Gateway tool and returns, in A's dev account. Measure cold and warm latency.
- [ ] Decide the agent language and framework: plain Bedrock Converse loop vs an agent SDK. Pick what keeps the loop short and cached.
- [ ] Check that Bedrock prompt caching works on Haiku 5.5 through Converse (`cachePoint`) and how image blocks count.
- [ ] Write `docs/adr/0001-agentcore-in-cdk.md`: what works, L2 vs L1 choices, language, measured latency, open issues.
- [ ] If IAM inbound or header pass-through is not available: stop and raise it. The fallback is a JWT authorizer with a dedicated machine-to-machine Cognito client (never the user's token), described in `architecture.md`.

## Acceptance criteria

- [ ] ADR merged with a clear yes or no for each capability.
- [ ] Hello runtime measured.

## Verification

- [ ] The ADR includes the deploy command, the invoke command and the measured latencies.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
