# Cost Estimate

Region: us-east-1. Prices below were read from the AWS Price List API on 2026-11-21 unless marked **list price, not re-fetched**. All usage figures are assumptions. Re-check prices before the demo.

## 1. Token math (Bedrock, Claude Haiku 5.5, global profile, standard context)

Rates per 1M tokens: input $0.10, output $0.50, cache read $0.01, cache write $0.125 (5 min) or $0.20 (1 h). The US geo profile costs 10% more ($0.11, $0.55, $0.011, $0.1375).

Assumptions per claim (the agent makes 2 model turns):

| Item | Tokens | Assumption |
|---|---|---|
| Static prefix (system prompt, tool definitions) | 2,000 | cached, above the 512-token minimum |
| Claim text and fields | 400 | |
| Evidence images and documents | 4,000 | about 2.5 images at roughly 1,600 tokens each (assumed) |
| Turn 1 output (tool calls) | 300 | |
| Tool results | 1,500 | |
| Turn 2 output (proposal JSON + draft) | 700 | |

| | With caching | Without caching |
|---|---|---|
| Turn 1 | 2,000 read + 400 fresh + 4,000 cache write + 300 out = **$0.00071** | 6,400 in + 300 out = $0.00079 |
| Turn 2 | 6,000 read + 2,200 fresh + 700 out = **$0.00063** | 8,200 in + 700 out = $0.00117 |
| **Model total per claim** | **$0.00134** | $0.00196 |

Caching saves about a third of model cost and shortens the second turn. At the US geo profile the cached cost is $0.00147. Controls in place: `maxTokens` per call, normalized images (at most 3.5 MB), 1-hour TTL for the static prefix, one cache checkpoint after the evidence.

## 2. Variable cost per claim

| Service | Assumption | Cost per claim |
|---|---|---|
| Bedrock model | above | $0.00134 |
| Bedrock Guardrails | 2 text units per claim, content filter $0.15 per 1K units plus prompt-attack check $0.00008 per unit (assumes both bill) | $0.00046 |
| AgentCore Runtime | 1 vCPU, 2 GB, 5 s at $0.1276 per vCPU-hour and $0.0169 per GB-hour (upper bound, idle I/O time may not bill) | $0.00022 |
| AgentCore Gateway | 3 tool calls at $0.000005 | $0.000015 |
| Lambda | Worker 1 GB x 8 s, Processor 1 GB x 1.5 s, Decision, 3 tools, Interceptor, API calls. $0.0000166667 per GB-s, $0.20 per 1M requests (x86) | $0.00017 |
| API Gateway HTTP API | 7 requests at $1.00 per 1M (**list price, not re-fetched**) | $0.000007 |
| SQS | 3 requests at $0.40 per 1M (**list price, not re-fetched**) | $0.000001 |
| DynamoDB on-demand | 12 write units at $0.625 per 1M, 25 read units at $0.125 per 1M | $0.000011 |
| S3 requests | 3 PUT, 6 GET | $0.000017 |
| KMS ticket signing | 1 asymmetric (ECC) `Sign` per attempt at $0.15 per 10K; verification is local with the cached public key | $0.000015 |
| **Total variable** | | **about $0.0023** |
| S3 storage | about 4.5 MB per claim at $0.023 per GB-month | $0.0001 per claim-month retained |

The assumption of $0.05 per claim in the earlier value model was about 20 times too high. The value model now uses this figure.

## 3. Monthly estimate by scenario

Fixed items: two KMS keys $2.00 (data key and ticket-signing key), about 8 CloudWatch alarms at $0.10, about 10 custom metrics at $0.30. CloudFront, S3 for the console, CloudTrail management events and SSM standard parameters are negligible or free at this size. Cognito at $0.015 per monthly active user is shown without any free tier, so the true figure may be lower.

| | Demo (500 claims, 20 users) | Pilot (8,333 claims, about 100,000 a year, 1,500 users) | Scale (100,000 claims, 15,000 users) |
|---|---|---|---|
| Variable (incl. 3 months of storage) | $1.28 | $21.36 | $256.33 |
| Fixed | $5.80 | $5.80 | $5.80 |
| Cognito | $0.30 | $22.50 | $225.00 |
| **Total per month** | **about $7** | **about $50** | **about $487** |

Cost per claim at pilot volume is about $0.006 including Cognito and fixed items. At scale Cognito is the largest single line, which is a reason to review the user model (for example Cognito's lower-cost tiers) before scaling.

## 4. Not included

CloudWatch dashboard charges beyond the free tier, data transfer out, Bedrock Guardrails on images ($0.75 per 1K images, deliberately not used), VPC interface endpoints (hourly per Availability Zone, pilot hardening), WAF, adjuster tooling, support plan.

## 5. Production savings

See `docs/value-model.md`. At pilot volume the platform costs about $600 a year against $0.3M to $1.1M of modelled benefit.

## 6. Lambda or Fargate for the Worker

Lambda Worker at 1 GB x 8 s costs about $0.00013 per claim. A Fargate task of 1 vCPU and 2 GB costs about $36 a month always on (list prices of $0.04048 per vCPU-hour and $0.004445 per GB-hour, **not re-fetched**). They match at roughly 270,000 claims a month. Below that Lambda is cheaper, and it needs no capacity planning.
