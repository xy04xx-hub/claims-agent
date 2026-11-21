# Architecture

Serverless, deployed with CDK in **us-east-1**. This is the agreed baseline. Changes need the user's approval.

Rationale, journeys, value numbers and the MVP/pilot/scale plan are in `docs/product-architecture-deep-dive.md`. Costs are in `docs/cost-estimate.md`. Diagram: `docs/architecture.drawio` and `docs/architecture.png`, built with `tools/diagram/build.sh` under the rules in `.kiro/steering/architecture-diagram.md`.

## Request flow

```
Browser (React console)
  -> CloudFront (HTTPS only) -> private S3 (console, via OAC)
  -> Cognito (groups Customer, Adjuster; custom:tenantId)
  -> API Gateway HTTP API (JWT authorizer on every route) -> API Lambda

1  POST /evidence/uploads   -> API Lambda returns presigned POST URLs (type and size limited)
   browser uploads photos and documents DIRECTLY to private S3 (evidence). Image bytes never pass through the API.
   S3 event -> Evidence Processor Lambda: SHA-256, pHash, EXIF, a normalized copy for the model -> DynamoDB EvidenceIndex
2  POST /claims (JSON metadata + evidenceIds, 202) -> API Lambda validates, writes claim PROCESSING, sends a job to SQS
3  SQS job queue (max receive 3) -> Worker Lambda (one claim per invocation, concurrency capped)
   Worker reads the claim from DynamoDB and the normalized evidence from S3
4  Worker invokes the Investigator agent (AgentCore Runtime) with the claim and evidence
5  Agent calls READ-ONLY tools through AgentCore Gateway (MCP). An Interceptor Lambda checks that every call is scoped to this claim and tenant.
   Tools: lookup_policy, check_fraud_signals, verify_evidence (Lambdas, DynamoDB read-only)
6  Agent calls Bedrock (Claude Haiku 5.5, Converse) with Guardrails applied to untrusted text, returns a structured proposal
7  Worker calls the Decision Lambda (approve_within_limit or route_to_adjuster). It re-fetches everything and writes the outcome + audit record.
   Failure path: after 3 failed receives the job goes to the DLQ, and the DLQ triggers the Decision Lambda in route-only mode.
8  Browser polls GET /claims/{claimId} until the status is final.
Ops: CloudWatch (logs, metrics, dashboard), AgentCore Observability (traces), CloudTrail (API audit), KMS, IAM, SSM Parameter Store
```

## Components

| Component | Responsibility |
|---|---|
| CloudFront + private S3 | Serves the React console over HTTPS. Bucket is not public (Origin Access Control). |
| Cognito | Sign-in. Groups `Customer` and `Adjuster`. JWT carries `custom:tenantId`. |
| API Gateway HTTP API | JWT authorizer on every route. Throttling configured. |
| API Lambda | Deployed as two functions with separate roles (customer routes, adjuster routes). Validates input against a schema, presigns uploads, writes claims, enqueues jobs, serves status, queue, evidence links and adjuster resolutions. Never calls Bedrock. |
| S3 evidence bucket | Photos and documents. Private, Block Public Access, `enforceSSL`, KMS, lifecycle retention. Key prefix `tenantId/customerId/evidenceId`. |
| Evidence Processor Lambda | On upload: SHA-256, perceptual hash, EXIF, a normalized JPEG at most 3.5 MB for the model (Bedrock image limits apply). Writes `EvidenceIndex`. |
| SQS job queue + DLQ | Standard queue, SSE-KMS. Message holds IDs only (no personal data). Visibility timeout at least 6 times the Worker timeout. `maxReceiveCount` 3. Batch size 1, partial batch responses on, event source max concurrency capped to protect Bedrock quotas. DLQ retention 14 days with an alarm on depth above 0. |
| Worker Lambda | Runs one claim: loads the claim and evidence, invokes the agent, calls the Decision Lambda. Timeout 60 s. Holds no decision-write permission. |
| Investigator agent (AgentCore Runtime) | Bedrock Converse tool-use loop. Reads through Gateway tools. **No write tool and no write IAM permission. No access to S3.** The Worker passes in the evidence. |
| AgentCore Gateway + Interceptor | Exposes the read-only tool Lambdas as MCP tools with JWT auth. The Interceptor Lambda rejects calls whose claim or tenant does not match the job scope, so a prompt-injected agent cannot read another customer's data. Tools accept a `claimId`, never a customer ID. |
| Read-only tool Lambdas | `lookup_policy` (plan, pack, version by loss date), `check_fraud_signals` (hash, identifier reuse, frequency, early claim, outlier), `verify_evidence` (compares extracted fields to the policy). |
| Decision Lambda | Contains `approve_within_limit` and `route_to_adjuster`. **The only role allowed to write a decision status.** Re-fetches policy, pack, signals and identifiers itself. Reads the kill switch. Also triggered by the DLQ. |
| Bedrock | Claude Haiku 5.5 (see Model choice). Guardrails (prompt-attack filter) on untrusted text. |
| DynamoDB | On-demand, encrypted with KMS, PITR. All keys carry `tenantId`. |
| CloudWatch, AgentCore Observability, CloudTrail | Structured logs, metrics, dashboard, alarms, model and tool traces, API audit. |
| KMS | One customer-managed key for S3 evidence, DynamoDB and SQS. |
| SSM Parameter Store | `autoApproveEnabled` kill switch and global defaults. |
| CDK | All infrastructure. No manual console resources. |

## API

All routes need a valid Cognito JWT. Role comes from `cognito:groups`, tenant from `custom:tenantId`. Neither is ever read from the body. Request bodies are validated against JSON schemas (type, length, allowed values, array limits). Errors use `400` (schema), `401`, `403`, `404`, `409` (idempotency conflict or already resolved), `429` (throttled).

| Route | Role | Purpose |
|---|---|---|
| `GET /me/policies` | Customer | Own active policies: insured items, covered causes, and the required evidence per cause from the claim type pack. Drives the intake form. |
| `POST /evidence/uploads` | Customer | Body: files (name, contentType, sizeBytes, kind). Returns `evidenceId` and a **presigned POST** per file with conditions: content type allow-list (JPEG, PNG, PDF), `content-length-range` up to 5 MB, key prefix. |
| `POST /claims` | Customer | Body: `clientRequestId`, `policyId`, `itemId`, `cause`, `description` (max 1,000 chars), `amountClaimed`, `lossDate`, `evidenceIds` (max 6). Verifies the item and evidence belong to the caller, writes the claim, enqueues the job, returns `202 {claimId, status: PROCESSING}`. Idempotent on `clientRequestId`. |
| `GET /claims/{claimId}` | Customer (own), Adjuster (tenant) | Status, decision, checks and reasons. Customer view hides internal signals and accusations. |
| `GET /claims` | Customer | Own claims, cursor paging. |
| `GET /queue` | Adjuster | Routed claims for the tenant, oldest first, cursor paging. |
| `GET /claims/{claimId}/evidence/{evidenceId}` | Customer (own), Adjuster | Returns a presigned GET valid 60 s. |
| `POST /claims/{claimId}/resolution` | Adjuster | Body: `decision` (APPROVE or REJECT), `reasonCode`, `note`. Conditional write only while status is `ROUTED_TO_ADJUSTER`. Writes the audit record. |
| `GET /impact` | Adjuster | Auto-handle rate, latency, estimated hours and dollars saved. |

**How claims and images arrive:** the API carries only small JSON (metadata and evidence IDs). Files go straight from the browser to S3 with presigned POST, which also enforces the size limit (a presigned PUT cannot). The Worker, not the API Lambda and not the agent, reads the files from S3. This avoids the API Gateway and Lambda payload limits and keeps image bytes out of logs and queues.

## Model choice (decided with the judging criteria in mind)

**Claude Haiku 5.5** (`global.anthropic.claude-haiku-5-5`, or `us.anthropic.claude-haiku-5-5` if US-only routing is needed) through the Converse API in us-east-1. Prices from the AWS Price List API for us-east-1, fetched 2026-11-21, per 1M tokens, standard context (prompts up to 100,000 tokens):

| Model | Input | Output | Cache read | Notes |
|---|---|---|---|---|
| **Claude Haiku 5.5, global profile** | $0.10 | $0.50 | $0.01 | Image and text input. Explicit caching on `system`, `messages` and `tools`, minimum 512 tokens, 5 min or 1 h TTL. Cache write $0.125 (5 min) or $0.20 (1 h). |
| Claude Haiku 5.5, US geo profile | $0.11 | $0.55 | $0.011 | 10% more. Use when data must stay in US Regions. |
| Nova 2 Lite | $0.33 | $2.75 | $0.0825 | Caching 5 min only, documented as mainly for text prompts. |
| Claude Haiku 4.5 | $1.00 | $5.00 | $0.10 | Cache minimum 4,096 tokens. |
| Claude Sonnet 5.5 | $2.00 | $10.00 | $0.10 | Candidate for an escalation tier later. |

Haiku 5.5 has the lowest token price of the vision-capable candidates, supports tool use and image input, and its 512-token cache minimum lets us cache the system prompt and tool definitions. Controls: `maxTokens` set per call, evidence normalized to at most 3.5 MB per image, 1-hour cache TTL on the static prefix, a cache checkpoint after the evidence so the second model turn reads it from cache. Estimated model cost is about $0.0013 per claim with caching and $0.0020 without. Details in `docs/cost-estimate.md`. Confirm availability and quotas in the account before the first build.

## Performance target

Happy path from submit to final status: **p50 about 4 s, p95 up to 6 s.** A spike to 6 s is accepted because scale, fail-safe routing and the audit trail are built in. Measure per stage (API accept, queue delay, Worker, agent turns, tool calls, Decision Lambda, client poll). The console polls every 500 ms for the first 10 s, then every 2 s. Levers if over budget: smaller images, fewer tokens, parallel tool calls, replace the agent loop with a fixed pipeline over the same Lambdas.

## Trust model

User input is never ground truth. The decision uses only the system of record. Everything else is checked against it.

| Level | Content | Use |
|---|---|---|
| System of record | Policy and plan, insured item identifiers (IMEI, VIN), claim history, evidence hashes, verified identity from the JWT | Decides |
| Claimant says | Claim text, amount, cause, loss date, uploaded files | Untrusted. Must be corroborated. |
| Model reads from evidence | Extracted fields, damage assessment, document fields | Signal only. Schema-checked. Low confidence routes. |

## Decision boundary (most important rule)

The model **proposes**, code **decides**.

- The Investigator reads data and returns a proposal. It cannot set the outcome. The Decision Lambda is not exposed through Gateway.
- The Decision Lambda **re-fetches the policy, pack, signals and identifiers itself** and does not trust the proposal's statements about data.
- The model maps the cause of loss to a **fixed cause list** (`THEFT`, `LOSS`, `ACCIDENTAL_DAMAGE`, ...). Anything it cannot map confidently is `UNCLEAR` and routes.
- `approve_within_limit` checks in code: policy active on the loss date, category covered, cause covered, required evidence for the cause present and consistent with the policy (see packs), amount within the cause-specific auto-approve cap, deductible and limit, no risk signals, `autoApproveEnabled` true. If any check fails it refuses and the claim is routed with a specific reason (for example "Cause 'THEFT' is not covered for 'phone' under POL-001 v3").
- Coverage failures never auto-reject. Only an adjuster can reject.
- The outcome is only `AUTO_APPROVED` or `ROUTED_TO_ADJUSTER` (with reasons). Only an adjuster can approve or reject a routed claim.
- Any error, timeout, schema failure or ambiguous result routes to an adjuster. Failures never auto-approve.
- Any change to the approval logic needs a test showing the model cannot cause approval above the cap or with a risk signal.

## Claim type packs (scalability seam)

Each tenant and category has a versioned **claim type pack** in `ClaimTypePacks`. Adding a category or a tenant is data, not code. A pack defines:

- allowed causes and, per cause, the **required evidence** (the console reads this to ask the customer for the right files)
- the **auto-approve cap per cause** (0 means always route)
- identifier fields to verify (IMEI, VIN, plate)
- typical-value table for outlier checks
- confidence thresholds for model extractions

Seed packs for the demo. The caps are **starting values to tune in shadow mode**, chosen from typical small-claim sizes, not from a data source:

| Category and cause | Required evidence | Auto-approve cap (net payout) |
|---|---|---|
| Phone, accidental damage | Photo of the damaged device showing the IMEI (for example the "About phone" screen) | $500 |
| Phone, theft | Police report (document or photo). Code compares name, IMEI or serial, incident date and report date to the policy. IMEI not claimed before. | $300, with a higher QA sampling rate |
| Phone, loss | Written statement, identifier on policy | $0 (always routes) |
| Car, windscreen or minor cosmetic | Photo showing the plate | $250 |
| Car, collision, injury, third party, theft, total loss | Police or incident report | $0 (always routes) |

**Limits of document checks.** Matching the report's name and IMEI to the policy proves consistency, not authenticity. A forged report that copies the policyholder's details passes the match. The MVP cannot verify authenticity. Mitigations: lower theft cap, identifier reuse check (an IMEI can be claimed stolen once), claim frequency, high-rate QA sampling of theft auto-approvals, and the kill switch. Pilot: verify reports with the issuing authority where a lookup exists, and check IMEI status with a blocklist service. Aviva reports a record 18,400 suspect claims in 2025, including AI-generated images and fake documents, so this threat is current ([Aviva](https://aviva.com/newsroom/news-releases/2026/06/aviva-stops-record-levels-of-claims-fraud-as-scams-become-more-sophisticated)).

## Signals

**Risk signals (block auto-approval, route with the reason):**

1. **Duplicate photo:** exact hash (SHA-256) and near-duplicate hash (pHash with a Hamming-distance threshold) matched across all of the tenant's evidence. The reason names the matching claim (e.g. `CLM-1042`).
2. **Identifier reuse:** the IMEI, VIN or report number was claimed before.
3. **Identity mismatch:** extracted name or identifier differs from the policy.
4. **Evidence mismatch:** the image does not show the claimed item, or the claimed damage, with enough confidence.
5. **Early claim:** filed within N days of policy start.
6. **Amount outlier:** amount far above the item's typical value (lookup table, not model judgment).
7. **Claim frequency:** more than N claims in a time window.
8. **Timeline inconsistency:** EXIF capture date or report date inconsistent with the loss date.

**Informational flags (recorded in the audit log, do not block):** `DOC_AUTHENTICITY_UNVERIFIED`, `EXIF_MISSING`. They raise the QA sampling rate for that claim type.

Known limit: hashing detects reused photos only. Edited or AI-generated images evade it. Roadmap: C2PA and provenance checks, image forensics as an extra signal that can only route, never approve.

Thresholds live in `ClaimTypePacks` (per category and cause) with global defaults and the kill switch in SSM. The values in force are copied into each audit record.

## Data model

All partition keys are prefixed with `tenantId`. The MVP runs one tenant.

- `Policies`: `policyId`, `version`, `customerId`, `startDate`, `effectiveFrom`, `effectiveTo`, `deductible`, insured items (category, identifiers such as IMEI or VIN, holder name), and a structured `coverage` map: category -> covered causes, limit. A policy change is a new version, never an in-place edit.
- `Claims`: `claimId`, `customerId`, `policyId`, `policyVersion`, `clientRequestId` (idempotency), status (`PROCESSING`, `AUTO_APPROVED`, `ROUTED_TO_ADJUSTER`, `APPROVED_BY_ADJUSTER`, `REJECTED_BY_ADJUSTER`), amount, description, evidence IDs, proposal, decision, reasons, `slaDueAt`, timestamps
- `EvidenceIndex`: key (`tenantId`, type, value) with type `SHA256`, `PHASH` or `IDENTIFIER` (IMEI, VIN, report number) -> `claimId`. Also holds per-evidence processing status and the S3 keys.
- `ClaimTypePacks`: versioned packs per tenant and category
- `AuditLog`: every decision with inputs, `policyId`, `policyVersion`, pack version, thresholds in force, checks passed and failed, risk signals, informational flags, outcome, actor (agent or adjuster), model and prompt versions, timestamp. Append-only. No photo bytes and no full personal data.

`lookup_policy` selects the version in force on the loss date, so a claim is judged on the terms that applied then. Policy changes take effect on the next claim with no redeploy. Policies are changed through the seed script for now.

Adjuster queue index: partition key `tenantId#status#shard` (shard by claim ID hash) so a large queue does not concentrate on one partition. Queries read the shards in parallel.

Access patterns: claims by customer, adjuster queue by tenant and status, evidence lookup by hash or identifier, policy by customer and loss date, pack by tenant and category.

## Tenancy and roles

- **Roles** are Cognito groups: `Customer` (own claims only) and `Adjuster` (queue, evidence, approve or reject).
- **Tenant** is the insurer or program that uses the product. `tenantId` comes from the verified JWT, never from the request. Every query is scoped to it.
- MVP and pilot: one tenant per deployment, deployed into the customer's AWS account with CDK. Scale: pooled tenants on the same keys.
- A `PolicyProvider` interface hides where policies come from. MVP: seed script. Pilot: scheduled import from the tenant's policy system.

## Compute choice

**Lambda for the API, Evidence Processor, Worker, Decision and tools. AgentCore Runtime for the agent.** Reasons: claim traffic is bursty, the judging criteria favour serverless with nothing provisioned, and the SQS queue already isolates the compute from the API. Limits to watch: 15-minute maximum (not an issue, a claim takes seconds), cold starts, account concurrency quotas in us-east-1, and the Worker paying for idle time while it waits for the agent (about 8 s of 1 GB per claim, roughly $0.00013).

**Fargate or EC2 is a pilot-or-later option, not needed now.** The Worker only reads from SQS, so it can move to an ECS Fargate service later with no change to the API or the queue. Triggers to move: sustained traffic where an always-on task is cheaper (rough crossover about 270,000 claims a month for a 1 vCPU, 2 GB task against the Lambda Worker, using list prices to be re-checked), a dependency Lambda cannot host (heavy image forensics, GPU), or a need for steadier latency. EC2 adds patching and capacity management and is not recommended.

## Kill switch

SSM parameter `autoApproveEnabled`. When `false`, `approve_within_limit` refuses every claim and all claims route to an adjuster. No deploy needed (cached for at most 60 s). Used when a bug, fraud wave, bad policy import or model misbehaviour is found.

## Observability

- AgentCore Observability and CloudWatch show traces of every model and tool call, token use, latency and errors. CloudWatch Omni is a stretch goal, subject to availability in the account.
- Structured JSON logs with `claimId` and a request ID. Custom metrics: auto-approved, routed (by reason code), error and fail-safe counts, DLQ depth, decision latency by stage. A CloudWatch dashboard shows them.
- CloudTrail records API activity. The console has an **impact panel** for adjusters and buyers: auto-handle rate, decision latency, estimated adjuster hours and dollars saved, from configured minutes and hourly rate.

## Failure handling

| Failure | Behaviour |
|---|---|
| Bedrock throttled or down | Capped retries with exponential backoff and jitter, then the job fails and SQS retries up to 3 receives |
| Third failed receive | Job moves to the DLQ. The DLQ triggers the Decision Lambda in route-only mode ("automatic check unavailable") and an alarm fires |
| Extraction fails schema or confidence | Route as unclear |
| No policy version in force for the loss date | Route with reason |
| Duplicate submit | `clientRequestId` returns the original result |
| Hash or identifier lookup fails | Treated as a risk signal "unable to verify" |
| Worker crashes mid-claim | SQS visibility timeout returns the job. The Decision Lambda uses a conditional write, so a claim is decided once |
| Prompt injection in claim text or documents | Input is delimited data, text passes Guardrails, outputs are schema-checked, the Interceptor scopes tool calls, the agent cannot write or approve |

## Open decisions to finalize

Record the answer in this section once agreed.

1. Auto-approve caps: the seed values above are starting points to be tuned in shadow mode.
2. Console framework (React + Vite assumed).
3. CDK language (TypeScript assumed) and repo layout (`infra/`, `backend/`, `frontend/`, `docs/`).
4. Near-duplicate hash method and distance threshold.
5. Retention period for evidence and audit records.
6. Seed data set for the demo (tenant, customers, policies with IMEI and VIN, `CLM-1042`, synthetic police report, damaged-phone photo with IMEI).
7. Global or US geo inference profile for Haiku 5.5 (10% price difference, data routing).
8. Check in the account: Bedrock quotas for Haiku 5.5, AgentCore Runtime, Gateway and interceptor availability in us-east-1, Lambda concurrency quota.

Settled:

- **Region us-east-1.**
- **Model: Claude Haiku 5.5** with prompt caching, `maxTokens` limits and normalized images.
- **No Knowledge Base on the decision path.** Coverage decisions use structured DynamoDB fields enforced in code.
- **Investigator agent on AgentCore Runtime with read-only tools through AgentCore Gateway and an Interceptor. The Decision Lambda is code outside the agent.**
- **Asynchronous submit with SQS and a DLQ.** 202 and polling. Client request ID for idempotency. DLQ routes the claim to an adjuster.
- **Evidence upload:** presigned POST from the browser to S3. Metadata only through the API. The Worker reads files from S3.
- **Compute: Lambda.** Fargate is a later option behind the same queue.
- **Latency target:** p50 about 4 s, p95 up to 6 s.
- **Thresholds and kill switch** in SSM and ClaimTypePacks. Values copied into the audit record.
- **`tenantId` in all keys** and a sharded queue index.
- **No event bus in the MVP.** DynamoDB Streams can provide the hook for payment and notification in the pilot.
- **Demo scope:** phones (damage and theft) and cars (low severity only). Health bills out of scope.

## Non-goals (for now)

Real payment integration, real personal or financial data, voice channel, ML-based fraud scoring, health bill claims, policy document ingestion (PDFs with tables and charts), a policy admin UI, a Knowledge Base for adjuster Q&A, VPC with private endpoints, and WAF. These are "next steps" for the demo.

Pilot hardening: VPC with gateway endpoints for S3 and DynamoDB and interface endpoints for the services the Lambdas call (interface endpoints cost per hour per Availability Zone, so they are not in the MVP), WAF on a CloudFront distribution in front of the API, report verification, shadow mode, QA sampling. Production path for policy PDFs: upload to private S3, extract structured fields with a Bedrock multimodal model, human review of the extracted record, save as a new policy version.
