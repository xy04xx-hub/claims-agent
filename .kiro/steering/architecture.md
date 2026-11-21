# Architecture

Serverless, deployed with CDK. This is the agreed baseline. Changes need the user's approval.

## Request flow

```
Browser
  -> CloudFront (HTTPS) -> private S3 (console static site, via OAC)
  -> Cognito (groups: Customer, Adjuster)
  -> API Gateway HTTP API (JWT authorizer)
  -> Lambda: claims agent
       -> Bedrock (text + image)
       -> tool Lambdas:
            - lookup_policy
            - check_fraud_signals
            - approve_within_limit
            - route_to_adjuster
  -> DynamoDB (policies, claims, photo hashes, audit log)
  -> private S3 (claim photos)
CloudWatch: logs, metrics, dashboard
```

## Components

| Component | Responsibility |
|---|---|
| CloudFront + private S3 | Serves the React console over HTTPS. Bucket is not public (Origin Access Control). |
| Cognito | Sign-in. Two groups: `Customer`, `Adjuster`. Issues JWTs. |
| API Gateway HTTP API | JWT authorizer on every route. Role checks in handlers. |
| Agent Lambda | Orchestrates the Bedrock conversation and tool calls. Never holds decision authority. |
| Tool Lambdas | Deterministic, code-enforced logic. Each does one job. |
| Bedrock | Understands the claim text and photo, extracts structured fields, drafts explanations. |
| DynamoDB | Policies, claims, photo hashes, audit records. On-demand billing. |
| Private S3 | Claim photos. Encrypted, Block Public Access, lifecycle retention rule. |
| CloudWatch | Structured logs, decision metrics, dashboard, alarms. |
| CDK | All infrastructure. No manual console resources. |

## Decision boundary (most important rule)

The model **proposes**, code **decides**.

- The model extracts claim details and calls tools. It cannot set the outcome.
- The model maps the cause of loss to a **fixed cause list** (for example `THEFT`, `LOSS`, `ACCIDENTAL_DAMAGE`). Anything it cannot map confidently is `UNCLEAR` and is routed to an adjuster.
- `approve_within_limit` re-checks everything in code: policy active on the loss date, item category covered, cause covered for that category, limit, deductible, amount below the auto-approve threshold, and zero fraud signals. If any check fails, it refuses and the claim is routed with a specific reason (for example "Cause 'THEFT' is not covered for 'phone' under POL-001 v3").
- Coverage failures never auto-reject. Only an adjuster can reject.
- The outcome is only `AUTO_APPROVED` or `ROUTED_TO_ADJUSTER` (with reasons). Only an adjuster can approve or reject a routed claim.
- Any error, timeout or ambiguous result routes to an adjuster. Failures never auto-approve.

## Fraud signals (deterministic)

1. **Duplicate photo:** exact hash (SHA-256) and near-duplicate hash (perceptual hash, for example pHash with a Hamming-distance threshold) matched against stored hashes. The reason names the matching claim ID (e.g. `CLM-1042`).
2. **Early claim:** claim filed within N days of policy start.
3. **Amount outlier:** amount far above the item's typical value (a lookup table, not model judgment).
4. **Claim frequency:** more than N claims in a time window.

Thresholds (auto-approve limit, N days, outlier multiple, frequency window) live in configuration (CDK context or SSM parameters), not hard-coded in handlers.

## Data model (initial sketch, confirm during design)

- `Policies`: `policyId`, `version`, `customerId`, `startDate`, `effectiveFrom`, `effectiveTo`, `deductible`, and a structured `coverage` map: category -> covered causes, limit. A policy change is a new version, never an in-place edit.
- `Claims`: `claimId`, `customerId`, `policyId`, `policyVersion`, status, amount, description, photo key, decision, reasons, timestamps
- `PhotoHashes`: hash, `claimId` (lookup for duplicate detection)
- `AuditLog`: every decision with inputs, `policyId`, `policyVersion`, coverage checks passed and failed, signals, outcome, actor (agent or adjuster), timestamp

`lookup_policy` selects the version in force on the loss date, so a claim is judged on the terms that applied then. Policy changes take effect on the next claim with no redeploy. Policies are changed through the seed script for now.

Access patterns to support: claims by customer, adjuster queue by status, hash lookup, policy by customer and loss date.

## Open decisions to finalize

Record the answer in this section once agreed.

1. AWS Region and Bedrock model (cost vs image-understanding quality). Must be available in the chosen Region.
2. Console framework (React + Vite assumed) and chat transport (request/response vs streaming).
3. CDK language (TypeScript assumed) and repo layout (`infra/`, `backend/`, `frontend/`, `docs/`).
4. Agent implementation: Bedrock Converse API with tool use directly, vs Bedrock Agents / AgentCore. Direct Converse is the simpler, cheaper default.
5. Auto-approve threshold value and the other fraud thresholds.
6. Near-duplicate hash method and distance threshold.
7. Photo upload path: presigned S3 PUT from the browser vs upload through the API.
8. Retention period for photos and audit records.
9. Seed data set for the demo (customers, policies, `CLM-1042`).

Settled:

- **No Knowledge Base on the decision path.** Coverage decisions use structured DynamoDB fields enforced in code. Retrieval is probabilistic, adds a vector store cost, and weakens the audit trail.

## Non-goals (for now)

Real payment integration, real personal or financial data, voice channel, ML-based fraud scoring, policy document ingestion (PDFs with tables and charts), a policy admin UI, and a Knowledge Base for adjuster Q&A. These are "next steps" for the demo.

Production path for policy PDFs: upload to private S3, extract structured fields with a Bedrock multimodal model, human review of the extracted record, save as a new policy version. An optional Knowledge Base over the same PDFs can answer adjuster questions with citations.
