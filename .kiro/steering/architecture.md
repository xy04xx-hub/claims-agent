# Architecture

Serverless, deployed with CDK. This is the agreed baseline. Changes need the user's approval.

Rationale, journeys, value numbers and the MVP/pilot/scale plan are in `docs/product-architecture-deep-dive.md`. Diagram: `docs/architecture.drawio`.

## Request flow

```
Browser
  -> CloudFront (HTTPS) -> private S3 (console static site, via OAC)
  -> Cognito (groups: Customer, Adjuster; custom:tenantId claim)
  -> API Gateway HTTP API (JWT authorizer)
  -> API Lambda: presign upload, intake, claim status, adjuster actions
       -> private S3 (claim evidence): browser uploads directly with a presigned PUT
            -> S3 event -> Evidence Processor Lambda: SHA-256, pHash, EXIF -> DynamoDB (EvidenceIndex)
       -> async invoke -> Orchestrator Lambda (claim status PROCESSING, API returns 202, console polls)
            1. invokes the Investigator agent (AgentCore Runtime, Bedrock Converse)
                 -> AgentCore Gateway (MCP, JWT auth) -> READ-ONLY tool Lambdas:
                      lookup_policy, check_fraud_signals, verify_evidence
                 -> returns a structured proposal (extracted fields, evidence assessment, draft text)
            2. calls the decision functions itself (never exposed to the model):
                 approve_within_limit | route_to_adjuster
  -> DynamoDB (Policies, Claims, EvidenceIndex, ClaimTypePacks, AuditLog)
SSM Parameter Store: kill switch, global defaults
CloudWatch + AgentCore Observability: traces, logs, metrics, dashboard
```

## Components

| Component | Responsibility |
|---|---|
| CloudFront + private S3 | Serves the React console over HTTPS. Bucket is not public (Origin Access Control). |
| Cognito | Sign-in. Groups `Customer` and `Adjuster`. JWT carries `custom:tenantId`. |
| API Gateway HTTP API | JWT authorizer on every route. Role and tenant checks in handlers, from verified claims only. |
| API Lambda | Validates input against a schema, presigns uploads (type and size limited), writes the claim as `PROCESSING` with an idempotency key, starts the Orchestrator, serves status and adjuster actions. |
| Evidence Processor Lambda | On upload: SHA-256, perceptual hash, EXIF read. Writes to `EvidenceIndex`. Decision time only does lookups. |
| Orchestrator Lambda | Runs the claim: calls the Investigator, then the decision functions. Catches errors and routes. A Lambda on-failure destination routes the claim if the Orchestrator itself fails. |
| Investigator agent (AgentCore Runtime) | Bedrock Converse tool-use loop. Reads evidence and policy through read-only tools, extracts fields, assesses evidence consistency, drafts the explanation. **Has no write tool and no write IAM permission.** |
| AgentCore Gateway | Exposes the read-only tool Lambdas as MCP tools with JWT auth. Reusable later by an adjuster copilot or other agents. |
| Read-only tool Lambdas | `lookup_policy` (plan, pack, version by loss date), `check_fraud_signals` (hash, frequency, early claim, outlier, identifier reuse), `verify_evidence` (compares extracted document and photo fields to the policy). |
| Decision Lambdas | `approve_within_limit` and `route_to_adjuster`. **The only roles allowed to write a decision status.** Re-fetch everything from the system of record. |
| Bedrock | Text and image understanding for the Investigator. Small model, `maxTokens` set. |
| DynamoDB | On-demand, encrypted, PITR. All keys carry `tenantId`. |
| Private S3 (evidence) | Photos and documents. Encrypted, Block Public Access, `enforceSSL`, lifecycle retention. |
| SSM Parameter Store | `autoApproveEnabled` (kill switch) and global defaults. |
| CloudWatch + AgentCore Observability | Traces of every model and tool call, structured logs, decision metrics, dashboard, alarms. |
| CDK | All infrastructure. No manual console resources. |

## Trust model

User input is never ground truth. The decision uses only the system of record. Everything else is checked against it.

| Level | Content | Use |
|---|---|---|
| System of record | Policy and plan, insured item identifiers (IMEI, VIN), claim history, evidence hashes, verified identity from the JWT | Decides |
| Claimant says | Claim text, amount, cause, loss date, uploaded files | Untrusted. Must be corroborated. |
| Model reads from evidence | Extracted fields, damage assessment, document fields | Signal only. Schema-checked. Low confidence routes. |

## Decision boundary (most important rule)

The model **proposes**, code **decides**.

- The Investigator reads data and returns a proposal. It cannot set the outcome, and `approve_within_limit` and `route_to_adjuster` are not exposed through Gateway.
- The Orchestrator calls the decision functions. They **re-fetch the policy, pack, signals and identifiers themselves** and do not trust the proposal's statements about data.
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

Seed packs for the demo:

| Category and cause | Required evidence | Auto-approve |
|---|---|---|
| Phone, accidental damage | Photo of the damaged device showing the IMEI (for example the "About phone" screen) | Yes, below the damage cap |
| Phone, theft | Police report (document or photo). Code compares name, IMEI or serial, incident date and report date to the policy. IMEI not claimed before. | Yes, below a **lower** theft cap, with a higher QA sampling rate |
| Phone, loss | Written statement, identifier on policy | Cap 0 (route) in the seed pack |
| Car, windscreen or minor cosmetic | Photo showing the plate | Yes, below a small cap |
| Car, collision, injury, third party, theft, total loss | Police or incident report | Cap 0, always route |

**Limits of document checks.** Matching the report's name and IMEI to the policy proves consistency, not authenticity. A forged report that copies the policyholder's details passes the match. The MVP cannot verify authenticity. Mitigations: lower theft cap, identifier reuse check (an IMEI can be claimed stolen once), claim frequency, 100% or high-rate QA sampling of theft auto-approvals, and the kill switch. Pilot: verify reports with the issuing authority where a lookup exists, and check IMEI status with a blocklist service.

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
- `Claims`: `claimId`, `customerId`, `policyId`, `policyVersion`, `clientRequestId` (idempotency), status (`PROCESSING`, `AUTO_APPROVED`, `ROUTED_TO_ADJUSTER`, `APPROVED_BY_ADJUSTER`, `REJECTED_BY_ADJUSTER`), amount, description, evidence keys, proposal, decision, reasons, `slaDueAt`, timestamps
- `EvidenceIndex`: key (`tenantId`, type, value) with type `SHA256`, `PHASH` or `IDENTIFIER` (IMEI, VIN, report number) -> `claimId`
- `ClaimTypePacks`: versioned packs per tenant and category
- `AuditLog`: every decision with inputs, `policyId`, `policyVersion`, pack version, thresholds in force, checks passed and failed, risk signals, informational flags, outcome, actor (agent or adjuster), timestamp. Append-only.

`lookup_policy` selects the version in force on the loss date, so a claim is judged on the terms that applied then. Policy changes take effect on the next claim with no redeploy. Policies are changed through the seed script for now.

Adjuster queue index: partition key `tenantId#status#shard` (shard by claim ID hash) so a large queue does not concentrate on one partition. Queries read the shards in parallel.

Access patterns: claims by customer, adjuster queue by tenant and status, evidence lookup by hash or identifier, policy by customer and loss date, pack by tenant and category.

## Tenancy and roles

- **Roles** are Cognito groups: `Customer` (own claims only) and `Adjuster` (queue, evidence, approve or reject).
- **Tenant** is the insurer or program that uses the product. `tenantId` comes from the verified JWT, never from the request. Every query is scoped to it.
- MVP and pilot: one tenant per deployment, deployed into the customer's AWS account with CDK. Scale: pooled tenants on the same keys.
- A `PolicyProvider` interface hides where policies come from. MVP: seed script. Pilot: scheduled import from the tenant's policy system.

## Kill switch

SSM parameter `autoApproveEnabled`. When `false`, `approve_within_limit` refuses every claim and all claims route to an adjuster. No deploy needed (cached for at most 60 s). Used when a bug, fraud wave, bad policy import or model misbehaviour is found.

## Observability

- AgentCore Observability and CloudWatch show traces of every model and tool call, token use, latency and errors. CloudWatch Omni is a stretch goal, subject to availability in the account and Region.
- Structured JSON logs with `claimId` and a request ID. Custom metrics: auto-approved, routed (by reason code), error and fail-safe counts, decision latency. A CloudWatch dashboard shows them.
- The console has an **impact panel** for adjusters and buyers: auto-handle rate, decision latency, estimated adjuster hours and dollars saved, from configured minutes and hourly rate.

## Failure handling

| Failure | Behaviour |
|---|---|
| Bedrock throttled or down | Capped retries with exponential backoff, then route "automatic check unavailable" |
| Extraction fails schema or confidence | Route as unclear |
| No policy version in force for the loss date | Route with reason |
| Duplicate submit | `clientRequestId` returns the original result |
| Hash or identifier lookup fails | Treated as a risk signal "unable to verify" |
| Orchestrator crashes | Lambda on-failure destination routes the claim |
| Prompt injection in claim text or documents | Input is delimited data, outputs are schema-checked, the Investigator cannot write or approve |
| Conditional write fails | Claim is not recorded as approved, it routes |

## Open decisions to finalize

Record the answer in this section once agreed.

1. AWS Region and Bedrock model (cost vs image and document understanding). Must be available in the chosen Region, together with AgentCore Runtime, Gateway and Observability.
2. Console framework (React + Vite assumed).
3. CDK language (TypeScript assumed) and repo layout (`infra/`, `backend/`, `frontend/`, `docs/`).
4. Auto-approve caps per category and cause, and the other thresholds.
5. Near-duplicate hash method and distance threshold.
6. Retention period for evidence and audit records.
7. Seed data set for the demo (tenant, customers, policies with IMEI and VIN, `CLM-1042`, synthetic police report, damaged-phone photo with IMEI).

Settled:

- **No Knowledge Base on the decision path.** Coverage decisions use structured DynamoDB fields enforced in code. Retrieval is probabilistic, adds a vector store cost, and weakens the audit trail.
- **Investigator agent on AgentCore Runtime with read-only tools through AgentCore Gateway. Decision functions are code outside the agent.**
- **Asynchronous submit:** 202 and polling. Client request ID for idempotency.
- **Evidence upload:** presigned S3 PUT from the browser.
- **Thresholds and kill switch** in SSM and ClaimTypePacks. Values copied into the audit record.
- **`tenantId` in all keys** and a sharded queue index.
- **No event bus in the MVP.** DynamoDB Streams can provide the hook for payment and notification in the pilot.

## Non-goals (for now)

Real payment integration, real personal or financial data, voice channel, ML-based fraud scoring, health bill claims, policy document ingestion (PDFs with tables and charts), a policy admin UI, and a Knowledge Base for adjuster Q&A. These are "next steps" for the demo.

Production path for policy PDFs: upload to private S3, extract structured fields with a Bedrock multimodal model, human review of the extracted record, save as a new policy version. An optional Knowledge Base over the same PDFs can answer adjuster questions with citations.
