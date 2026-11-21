# Cost Estimate

Region: us-east-1. Prices below were read from the AWS Price List API on 2026-11-21 unless marked **list price, not re-fetched**. All usage figures are assumptions. Re-check prices before the demo.

## 1. Token math (Bedrock, Claude Haiku 4.5, global profile, standard context)

Claude Haiku 5.5 was the first choice but is blocked by the workshop model allowlist, so this estimate uses Haiku 4.5 (`global.anthropic.claude-haiku-4-5-20251001-v1:0`).

Rates per 1M tokens: input $1.00, output $5.00 (as given for this project). Cache read $0.10, cache write $1.25 (5 min) or $2.00 (1 h) are Anthropic list multipliers (0.1x, 1.25x, 2x), **not re-fetched**. The US geo profile price was not re-fetched.

**Cache minimum: 4,096 tokens.** The 2,000-token static prefix is below it and cannot be cached on its own. The checkpoint after the evidence covers the whole 6,400-token prefix, which is above the minimum, so turn 1 writes it (5-minute write) and turn 2 reads it.

Assumptions per claim (the agent makes 2 model turns):

| Item | Tokens | Assumption |
|---|---|---|
| Static prefix (system prompt, tool definitions) | 2,000 | below the 4,096-token minimum, cached only as part of the 6,400-token prefix |
| Claim text and fields | 400 | |
| Evidence images and documents | 4,000 | about 2.5 images at roughly 1,600 tokens each (assumed) |
| Turn 1 output (tool calls) | 300 | |
| Tool results | 1,500 | |
| Turn 2 output (proposal JSON + draft) | 700 | |

| | With caching | Without caching |
|---|---|---|
| Turn 1 | 6,400 cache write + 300 out = **$0.00950** | 6,400 in + 300 out = $0.00790 |
| Turn 2 | 6,400 read + 1,800 fresh + 700 out = **$0.00594** | 8,200 in + 700 out = $0.01170 |
| **Model total per claim** | **$0.01544** | $0.01960 |

Caching saves about a fifth of model cost (21%) and shortens the second turn. The saving is smaller than with a cheaper-to-write cache because the 5-minute write costs 1.25x the input price and each claim pays it once. Controls in place: `maxTokens` per call, normalized images (at most 3.5 MB), one cache checkpoint after the evidence. A 1-hour TTL on the static prefix alone has no effect below 4,096 tokens.

Cheaper production option: Nova 2 Lite ($0.33 input, $2.75 output per 1M tokens, Price List API 2026-11-21) would cost about $0.0076 per claim for the same tokens without caching, under half of Haiku 4.5 without caching ($0.0196). Image reading quality and caching for this workload are untested, so it is a later evaluation, not part of this estimate.

## 2. Variable cost per claim

| Service | Assumption | Cost per claim |
|---|---|---|
| Bedrock model | above | $0.01544 |
| Bedrock Guardrails | 2 text units per claim, content filter $0.15 per 1K units plus prompt-attack check $0.00008 per unit (assumes both bill) | $0.00046 |
| AgentCore Runtime | 1 vCPU, 2 GB, 5 s at $0.1276 per vCPU-hour and $0.0169 per GB-hour (upper bound, idle I/O time may not bill) | $0.00022 |
| AgentCore Gateway | 3 tool calls at $0.000005 | $0.000015 |
| Lambda | Worker 1 GB x 8 s, Processor 1 GB x 1.5 s, Decision, 3 tools, Interceptor, API calls. $0.0000166667 per GB-s, $0.20 per 1M requests (x86) | $0.00017 |
| API Gateway HTTP API | 7 requests at $1.00 per 1M (**list price, not re-fetched**) | $0.000007 |
| SQS | 3 requests at $0.40 per 1M (**list price, not re-fetched**) | $0.000001 |
| DynamoDB on-demand | 12 write units at $0.625 per 1M, 25 read units at $0.125 per 1M | $0.000011 |
| S3 requests | 3 PUT, 6 GET | $0.000017 |
| KMS ticket signing | 1 asymmetric (ECC) `Sign` per attempt at $0.15 per 10K; verification is local with the cached public key | $0.000015 |
| **Total variable** | | **about $0.0164** |
| S3 storage | about 4.5 MB per claim at $0.023 per GB-month | $0.0001 per claim-month retained |

The assumption of $0.05 per claim in the earlier value model was about 3 times too high. The value model now uses this figure.

## 3. Monthly estimate by scenario

Fixed items: two KMS keys $2.00 (data key and ticket-signing key), about 8 CloudWatch alarms at $0.10, about 10 custom metrics at $0.30. CloudFront, S3 for the console, CloudTrail management events and SSM standard parameters are negligible or free at this size. Cognito at $0.015 per monthly active user is shown without any free tier, so the true figure may be lower.

| | Demo (500 claims, 20 users) | Pilot (8,333 claims, about 100,000 a year, 1,500 users) | Scale (100,000 claims, 15,000 users) |
|---|---|---|---|
| Variable (incl. 3 months of storage) | $8.33 | $138.86 | $1,666.33 |
| Fixed | $5.80 | $5.80 | $5.80 |
| Cognito | $0.30 | $22.50 | $225.00 |
| **Total per month** | **about $14** | **about $167** | **about $1,897** |

Cost per claim at pilot volume is about $0.020 including Cognito and fixed items. At scale the Bedrock model is the largest line (about $1,544 of the $1,897), followed by Cognito at $225. Review the model choice (for example Nova 2 Lite) and the user model (for example Cognito's lower-cost tiers) before scaling.

## 4. Not included

CloudWatch dashboard charges beyond the free tier, data transfer out, Bedrock Guardrails on images ($0.75 per 1K images, deliberately not used), VPC interface endpoints (hourly per Availability Zone, pilot hardening), WAF, adjuster tooling, support plan.

## 5. Production savings

See `docs/value-model.md`. At pilot volume the platform costs about $2,000 a year against $0.3M to $1.1M of modelled benefit.

## 6. Lambda or Fargate for the Worker

Lambda Worker at 1 GB x 8 s costs about $0.00013 per claim. A Fargate task of 1 vCPU and 2 GB costs about $36 a month always on (list prices of $0.04048 per vCPU-hour and $0.004445 per GB-hour, **not re-fetched**). They match at roughly 270,000 claims a month. Below that Lambda is cheaper, and it needs no capacity planning.
