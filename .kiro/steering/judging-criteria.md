# Hackathon Judging Criteria

Every design and implementation choice should raise the score under these criteria. Source: the organizers' "Proposed Judging Criteria" and "Well-Architected Items" slides (labelled "Proposed", so confirm if they change).

## Scoring

Six categories, each rated 1 to 5. Business categories count double. Top score is 45.
**Ties go to the higher Value score.**

| Category | Weight | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| Complete | ×2 | Idea or mockup | Some screens | Main flow works | Most flows work | Ready to pilot |
| Value | ×2 | No clear user or problem | User named, problem vague | Clear user and problem | Benefit explained | Benefit in hours or dollars |
| Presentation | ×2 | No working demo | Demo hard to follow | Clear live demo | Adds problem and result | Adds next steps, on time |
| Operational excellence | ×1 | 0-1 items | 2 items | 3 items | 4 items | All 5 items |
| Security | ×1 | 0-1 items | 2 items | 3 items | 4 items | All 5 items |
| Cost optimization | ×1 | 0-1 items | 2 items | 3 items | 4 items | All 5 items |

Equal item counts tie, even when teams show different items. **Target: all 5 items in each Well-Architected pillar, and a 5 in each Business category.**

## Well-Architected items (count the items the demo shows)

### Operational excellence
1. **Built from code:** deploys from CDK or CloudFormation.
2. **Logs:** logs and metrics in CloudWatch.
3. **Error handling:** errors handled, failed calls retried.
4. **Fast responses:** no long waits in the demo.
5. **Docs:** README to run and change it.

### Security
1. **Authentication:** users must sign in.
2. **Authorization:** each role sees only its data.
3. **Least privilege:** app roles reach only what they need.
4. **Network security:** HTTPS only, no public data stores.
5. **App security:** inputs checked, no secrets in code.

### Cost optimization
1. **Monthly estimate:** monthly cost, including Bedrock tokens.
2. **Detailed pricing:** cost by service, with usage assumptions.
3. **Cost-efficient services:** Lambda or serverless, nothing oversized.
4. **Bedrock cost controls:** model choice, caching, token limits.
5. **Production savings:** estimated savings or gain in production.

## Mapping each item to a deliverable

Only items the team can **show** in the demo are counted, so each needs something visible.

| Item | Where it is shown |
|---|---|
| Built from code | `cdk deploy` output or the CDK stack in the repo |
| Logs | CloudWatch dashboard with agent logs and decision metrics |
| Error handling | Retry/backoff on Bedrock and tool calls; a visible failure path that routes to an adjuster |
| Fast responses | Auto-approval completes in seconds on the live demo |
| Docs | `README.md` with run, deploy and change instructions |
| Authentication | Cognito sign-in for Customer and Adjuster |
| Authorization | Customer sees only own claims; adjuster sees the queue |
| Least privilege | Per-Lambda IAM roles scoped to specific tables, buckets and models |
| Network security | CloudFront HTTPS, private S3, Block Public Access, no public data stores |
| App security | Input validation, prompt-injection guard, secrets not in code |
| Monthly estimate | `docs/cost-estimate.md` with Bedrock token math |
| Detailed pricing | Per-service table with usage assumptions |
| Cost-efficient services | Serverless only (Lambda, DynamoDB on-demand, HTTP API) |
| Bedrock cost controls | Small model, token limits, caching, deterministic code for decisions |
| Production savings | Value model (adjuster time saved, cycle time, fraud caught) |

## Business priorities (double weight)

- **Complete:** aim for "ready to pilot". Customer chat, agent decision, adjuster console and audit log must all work end to end on seeded test data.
- **Value:** state the benefit in hours or dollars, from the value model in `product.md`.
- **Presentation:** rehearse the 4-minute script to time. Include the problem, the live demo, the result and next steps.
