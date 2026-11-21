# Instant Claims Agent: Product and Architecture Deep Dive

Status: **reviewed and applied.** The decisions in section 8 are now in `architecture.md` and `product.md`. Where this document and the steering files differ, the steering files win.

## 1. Where the current design falls short

The current steering files describe a correct demo path (file claim, check, approve or route). They are thin in six places that a buyer or a pilot sponsor would ask about on day one:

| Gap | Why it matters |
|---|---|
| No named buyer or wedge | "Insurance" is too broad. A buyer needs to see their own claim type and their own cost. |
| Value model is a formula with blanks | The judging criteria want the benefit in hours or dollars. No numbers exist yet. |
| No path from demo to pilot | "Ready to pilot" needs shadow mode, success metrics and an integration plan, not only working screens. |
| Synchronous agent behind an HTTP API | API Gateway HTTP API has a 30 s integration limit. A multi-turn Bedrock loop with retries can exceed it. |
| No event seam | Payment, notification and analytics have nowhere to plug in without rewriting the agent. |
| No feedback loop | Nothing measures whether auto-approvals were right, so thresholds can't be tuned with evidence. |

## 2. Who buys this, and what problem it solves

### Buyer hypothesis (to validate in discovery)

Target carriers and programs where **claims are high-volume, low-severity and evidence-light**. Handling a $300 claim costs nearly as much adjuster time as a $3,000 one, so the small ones are where handling cost is out of proportion to the claim value.

| Segment | Example claim | Why it fits |
|---|---|---|
| Device and gadget protection (embedded insurance, telcos, retailers) | Stolen or damaged phone | Photo plus receipt evidence, clear item values, high duplicate risk |
| Renters and contents | Stolen laptop, bicycle | Category and cause lists map directly to structured coverage |
| Travel | Delayed baggage, lost item | Small amounts, clear documents |
| Warranty and returns administrators | Defective appliance | Same pattern, less regulation. Good first pilot because the compliance bar is lower |

Our own clients may be closer to warranty, returns and expense claims than to regulated insurance (see the risk row in `product.md`). A warranty administrator is the lowest-risk first design partner. A regulated carrier is the larger prize.

### The problem in numbers

All figures are from public sources. Secondary sources are marked.

- Loss adjustment expense (LAE) is the cost of investigating and settling claims. P&C insurers typically run about 5 to 15% of premium on claims adjustment ([analystinterview.com](https://www.analystinterview.com/article/claims-adjustment-expense-ratio-in-insurance-sector), secondary source). One report puts the 2025 US P&C total at about $86 billion, roughly 9 cents per premium dollar ([ventavid.com](https://www.ventavid.com/blog/loss-adjustment-expense-cost-per-claim), secondary source citing NAIC).
- Lemonade reports its LAE ratio fell from 13% to 7% as it automated claims ([beinsure.com](https://beinsure.com/news/lemonade-narrows-q3-loss-45/)). Its filings say about 55% of claims are fully automated ([imagine.ai summary of the FY2025 10-K](https://imagine.ai/research/lemonade), secondary source).
- Roughly 10% of P&C claims contain some element of fraud, according to NICB estimates ([gainsco.com](https://www.gainsco.com/news/insurance-fraud/)). The Coalition Against Insurance Fraud puts total US insurance fraud at $308.6 billion a year ([insurancefraud.org](https://insurancefraud.org/wp-content/uploads/The-Impact-of-Insurance-Fraud-on-the-U.S.-Economy-Report-2022-8.26.2022-1.pdf)).
- Lemonade states it never lets AI auto-reject claims ([lemonade.com](https://www.lemonade.com/blog/lemonades-claim-automation/)). That supports our rule that coverage failures route to a person.

**Our pitch:** a carrier with 7 to 13% LAE can't match Lemonade's cost structure because it can't rebuild its claims stack. We offer the same "automatic or human" decision as a layer on top of the carrier's existing policy data, deployed in the carrier's own AWS account.

### Positioning hypotheses (not yet tested against competitors)

- Claims automation vendors exist already. Our differentiators to test: the decision boundary is enforced in code and testable, every decision is versioned and explainable, and deployment is in the customer's account (no claims data leaves it).
- We did not research named competitors for this document. Do that before the pitch if judges will ask.

## 3. Value model

Full numbers, published results from Allianz, Lemonade and Aviva, and the cross-check against industry cost ratios are in `docs/value-model.md`. Platform costs are in `docs/cost-estimate.md`.

| | Conservative | Base |
|---|---|---|
| Adjuster time saved per 100,000 claims a year | $175,000 (5,000 h, about 2.4 FTE) | $666,667 (16,667 h, about 8 FTE) |
| Fraud paid out and avoided | $125,000 | $420,000 |
| **Total benefit** | **$300,000** | **$1,086,667** |
| Platform cost at pilot volume | about $600 a year | about $600 a year |

Inputs are assumptions until a design partner supplies data. The base case sits inside the top-down range implied by published expense ratios (a 2-point drop in claims adjustment expense is about $1.1M for this carrier).

## 4. User journeys

### 4.1 Customer: covered, small, clean claim (target p50 about 4 s, p95 up to 6 s from submit)

1. Signs in (Cognito) and opens a new claim.
2. Describes what happened. The console asks for the evidence the claim type requires (for example a photo showing the IMEI) and uploads it directly to S3 with a presigned URL.
3. Submits. The UI shows progress steps as they complete.
4. Sees the decision: **Approved**, with the checks shown: policy active, item covered, cause covered, within limit, deductible applied, no fraud signals.
5. Sees the payout amount and when it will be paid (payment itself is a next step).

### 4.1b Customer: stolen phone with a police report

1. The console asks for the police report because the cause is theft.
2. The agent extracts name, IMEI or serial, incident date and report date. Code compares them to the policy and checks that this IMEI was never claimed before.
3. If everything matches and the amount is under the theft cap, the claim is approved and the match results are shown. Otherwise it routes with the specific mismatch.
4. The audit record notes that document authenticity is unverified, and the claim is more likely to be picked for QA sampling.

### 4.2 Customer: not covered

1. Same steps up to the decision.
2. Sees "needs review" with the reason in plain words ("Theft is not covered for phones under your policy POL-001").
3. The claim is in an adjuster queue. The customer sees the status, an expected review time, and that a person will decide. Nothing is rejected automatically.

### 4.3 Customer: duplicate photo

1. Same steps. Fraud check matches the photo hash to `CLM-1042`.
2. Customer sees "needs review". The customer-facing text does **not** accuse. It says a person will look at the claim.
3. The adjuster sees the specific reason and a side-by-side of both photos. The accusation detail stays internal.

### 4.4 Customer: system failure

1. Bedrock or a tool times out after capped retries.
2. The claim is saved and routed to an adjuster with reason "automatic check unavailable". The customer sees a clear message and keeps their claim ID.

### 4.5 Adjuster

1. Opens the queue, sorted by age and SLA. Each row shows reason codes and amount.
2. Opens a claim: evidence, extracted fields, policy version used, each check result, fraud signals, and the agent's draft explanation.
3. Approves or rejects, with a required reason code. The decision is written to the audit log with the adjuster's identity.
4. The reason code feeds the feedback loop (section 5.8).

### 4.6 Policy owner or compliance (pilot, not MVP UI)

1. Changes a policy by publishing a new version (seed script for the MVP, import job for the pilot).
2. Pulls the audit trail for any claim: inputs, policy version, thresholds in force, checks, outcome, actor.
3. Reviews the weekly sample of auto-approvals (section 5.8).

## 5. Architecture: what to deepen

These are the design decisions that deepen the baseline in `architecture.md`, in priority order. The agreed outcome is in section 8.

### 5.1 Investigator agent proposes, code decides (decided: option C)

1. The **Worker Lambda** takes a claim from SQS, loads the claim and the normalized evidence from S3, and invokes the **Investigator agent on AgentCore Runtime** (Bedrock Converse tool use, Claude Haiku 5.5).
2. The agent calls **read-only tools through AgentCore Gateway** in parallel: `lookup_policy`, `check_fraud_signals`, `verify_evidence`. The Runtime authenticates to the gateway with its own IAM role (no user token is ever forwarded). The Worker gives the agent a **KMS-signed job ticket** for this one claim, and the runtime code attaches it to every MCP call. The **Interceptor Lambda** verifies the ticket and writes the claim and tenant into each tool call, so a prompt-injected agent cannot read anyone else's data. See "Credentials and tokens" in `architecture.md`.
3. The agent returns a schema-validated **proposal**: extracted fields (item, cause from the fixed list, amount, loss date, identifiers), an evidence assessment with confidence, and a draft explanation.
4. The Worker then calls the **Decision Lambda** (`approve_within_limit` or `route_to_adjuster`). It is not exposed to the model. It re-fetches the policy, pack, signals and identifiers and does not trust the proposal's statements about data.

The agent has no S3 access: the Worker passes the evidence in. That keeps one more path closed for cross-claim data access.

Why this shape: the agent does the work where reasoning helps (reading messy evidence, reconciling fields). Code does the work where guarantees matter. Gateway tools can later serve an adjuster copilot and other agents, and AgentCore Observability traces every model and tool call. Target happy-path latency is p50 about 4 s and p95 up to 6 s (see `architecture.md`). If it runs over, fall back to a fixed pipeline: the model extracts once and code calls the same Lambdas directly.

### 5.2 Asynchronous submit with SQS and a DLQ (decided)

- `POST /claims` validates input, writes the claim as `PROCESSING`, sends a job to **SQS** and returns `202` with the claim ID. The console polls `GET /claims/{id}` (every 500 ms for the first 10 s, then every 2 s).
- **Why SQS and not a direct async Lambda invoke:** the queue absorbs bursts, a concurrency cap on the event source mapping protects Bedrock and AgentCore quotas, visibility timeouts give controlled retries, and a DLQ makes failures visible and recoverable.
- Settings: standard queue, SSE-KMS, message holds IDs only, batch size 1, partial batch responses, visibility timeout at least 6 times the Worker timeout (60 s), `maxReceiveCount` 3, DLQ retention 14 days, alarm when DLQ depth is above 0.
- **DLQ is a fail-safe, not a graveyard:** the DLQ triggers the Decision Lambda in route-only mode, so the claim reaches an adjuster with "automatic check unavailable". This implements "failures never auto-approve".
- Idempotency: the client sends a `clientRequestId`. A conditional DynamoDB write prevents a retry from creating or approving a claim twice, and the Decision Lambda writes with a condition so a claim is decided once. FIFO is not needed because ordering does not matter.

### 5.3 Keep separate Lambdas, because they are the security boundary

The extra Lambdas add a network hop and cold start. Keep them for one reason: **only the Decision Lambda holds IAM permission to write a decision status.** The Investigator's role is read-only and cannot write `AUTO_APPROVED`, even if its code or prompt is compromised. The API is deployed as two functions (customer and adjuster routes) for the same reason: separate roles. This is the structural defence against prompt injection that the engineering rules call for. Document it in the CDK stack, and add the required test that no path reaches approval above the limit or with a fraud signal.

Latency mitigation: provisioned concurrency is not serverless-cheap, so use small Node.js or Python bundles without heavy dependencies, and compute photo hashes at upload time (5.5), not at decision time.

### 5.4 Event bus (deferred)

An event on every decision would let payment, notification and analytics react without changing the agent. It is not needed for the MVP. DynamoDB Streams provide the same hook when the pilot needs it.

### 5.5 Evidence and fraud pipeline

- Browser uploads photos and documents with a **presigned POST**, which can enforce a size range and content type (a presigned PUT cannot enforce size). Types: JPEG, PNG, PDF. Up to 5 MB per file.
- An S3 event Lambda computes SHA-256, pHash and EXIF, and writes to `EvidenceIndex` before the claim is submitted. Identifiers extracted from the evidence (IMEI, VIN, report number) go into the same index so reuse can be detected.
- **Trust model:** the claim and files are untrusted, the system of record decides, and model reads of images and documents are signals. See `architecture.md`.
- **Claim type packs** define required evidence, causes, caps and identifiers per tenant and category.
- **Theft with a police report can auto-approve** under a lower cap. Code checks that name, IMEI or serial and dates match the policy and that the IMEI was not claimed before. This proves consistency, not authenticity, so a forged report that copies the policyholder's details would pass. Mitigations: lower cap, identifier reuse, frequency, high-rate QA sampling. Pilot: verify reports with the issuing authority.
- Cars auto-approve only low-severity causes (windscreen, minor cosmetic). Collision, injury, third party, theft and total loss always route.
- Health bills are out of scope. They need document extraction, billing code checks, provider validation and stricter regulation, so they would start as human review only. The decision path only does lookups.
- Near-duplicate search: with a few thousand hashes, a scan or a prefix-bucketed lookup of pHash with Hamming distance is fine. At scale, move to a BK-tree or a vector index. Note this as a scale item, not an MVP item.
- Known limit, state it openly: hash matching catches reused photos only. Edited or AI-generated images evade it. Roadmap: EXIF and C2PA provenance checks, model-based image forensics routed as a signal (never as an approver).

### 5.6 Multi-tenancy and deployment model

- **MVP and pilot: single tenant per deployment.** The CDK stack deploys into the customer's AWS account. This answers the data-residency and security questions of regulated buyers and keeps IAM simple.
- **Scale: add `tenantId` to every partition key from the start** (cheap now, painful later). This allows a pooled SaaS option later without a data migration. (decided) to add `tenantId` to the data model now.
- A `PolicyProvider` interface hides where policies come from. MVP: DynamoDB seed. Pilot: scheduled import (CSV or API) from the customer's policy system into versioned records.

### 5.7 Configuration and thresholds

- Thresholds live in SSM Parameter Store (settles the CDK-context-or-SSM question in favour of SSM, so they change without redeploy): auto-approve limit per category, early-claim days, outlier multiple, frequency window and count.
- The values in force are copied into each audit record, so a past decision can be explained after thresholds change.
- Start with a low auto-approve limit and raise it only when the metrics in 5.8 support it.

### 5.8 Feedback loop and quality control (what makes it pilot-ready)

| Control | How |
|---|---|
| Shadow mode | In the pilot's first phase the agent decides but never pays. Adjusters work as today. Compare agent and adjuster outcomes. This is how a regulated buyer says yes. |
| Sampled QA of auto-approvals | A configurable percentage of auto-approved claims also go to an adjuster after the fact. Disagreements are the false-approval rate. |
| Override analytics | Adjuster reason codes on routed claims show which rules over-route (candidates to relax) and which routed claims were rightly stopped. |
| Kill switch | An SSM flag that sets the auto-approve limit to zero. Every claim then routes. |

### 5.9 Data model changes for scale (decided)

- **Queue GSI hot partition.** A single `status = ROUTED` key concentrates all queue reads and writes on one partition. Use `tenantId#status#shard` (shard by claim ID hash or date) and query the shards in parallel.
- Add `slaDueAt` and `assignedTo` to routed claims for adjuster workflow.
- Audit log is append-only. For the pilot, export it nightly to S3 with Object Lock so it can't be altered. MVP: DynamoDB with PITR is enough.

### 5.10 Observability: the metrics that tell the story

Emit as CloudWatch custom metrics, show on the dashboard and on the adjuster console as an impact panel (the visible proof for the value slide) (decided):

- Auto-handle rate, routed count by reason code
- Decision latency p50 and p95
- Bedrock errors, retries, and fail-safe routes
- Estimated adjuster hours saved (auto-handled count x configured minutes) and dollars at the configured hourly rate

### 5.11 Failure modes

| Failure | Behaviour |
|---|---|
| Bedrock throttled or down | Capped retries with backoff, then route with "automatic check unavailable" |
| Extraction output fails schema | Route as unclear. Never retry into approval |
| Policy not found or no version in force for the loss date | Route with reason |
| Duplicate submit | Idempotency key returns the original result |
| Hash lookup fails | Treated as a fraud signal "unable to verify", so route |
| Prompt injection in claim text | Text is delimited data, outputs are schema-checked, and the agent role can't write approval |
| DynamoDB conditional write fails | Decision not recorded as approved, claim routes |

### 5.12 How claims and images reach the backend, and the compute choice

- **Claims** arrive as small JSON through the API (metadata and evidence IDs, schema-validated). **Images and documents never go through the API.** They go from the browser to private S3 with presigned POST. This avoids the API Gateway and Lambda payload limits, keeps image bytes out of logs and queues, and lets S3 enforce the size and type limits.
- **Who reads S3:** the Evidence Processor (to hash and normalize), the Worker (to pass the evidence to the agent), and the API Lambda only to presign short-lived GET links for the customer and adjuster. The agent itself has no S3 access.
- **API routes** are listed in `architecture.md`: policies, evidence upload URLs, claim submit, claim status and list, adjuster queue, evidence link, adjuster resolution, impact metrics.
- **Compute:** Lambda for everything except the agent (AgentCore Runtime). Claim traffic is bursty, Lambda scales to zero, and the queue already isolates it. The Worker is the one component that could move to Fargate later because it only reads from SQS. A Lambda Worker costs about $0.00013 per claim, and an always-on 1 vCPU, 2 GB Fargate task costs about $36 a month, so they cross at roughly 270,000 claims a month (list prices to be re-checked). EC2 is not recommended: patching and capacity management for no benefit here.
- **Network:** the MVP uses IAM-scoped access over TLS, with no VPC. Interface endpoints cost per hour per Availability Zone, so VPC endpoints, WAF on a CloudFront distribution in front of the API, and private connectivity are pilot hardening for regulated tenants.

## 6. MVP, pilot and scale

| | MVP (hackathon) | Pilot (about 8 to 12 weeks, one design partner) | Scale |
|---|---|---|---|
| Goal | Prove the decision boundary and the value on seeded data | Prove accuracy and savings on real claims, safely | Run many carriers or programs |
| Data | Synthetic policies, `CLM-1042` | One claim type from one partner. Real data only under the partner's agreement, in their account | Many tenants |
| Decision mode | Live on test data | **Shadow mode first**, then live for the lowest-risk segment | Live, with QA sampling |
| Policy source | Seed script, versioned records | Scheduled import from partner system, human-reviewed | Multiple policy-system adapters. PDF ingestion with review |
| Fraud | 4 deterministic signals | Add partner-specific signals, EXIF checks | Provenance checks, consortium data, ML score as extra signal |
| Integration | None | Notification and payment adapter via `ClaimDecided` | Case management, data lake |
| Ops | CloudWatch dashboard | Alarms, QA sampling, kill switch, nightly audit export | Multi-region, per-tenant cost tracking |
| Success gate | Demo in under 4 minutes with $ numbers | Auto-handle rate, false-approval rate under an agreed ceiling in shadow mode, adjuster hours saved against baseline | Unit cost per claim, SLA |

Suggested pilot exit gates (propose to the partner, tune together): shadow-mode agreement with adjusters on auto-approvals above an agreed level, zero auto-approvals found with a fraud signal, p95 decision latency under 10 s.

## 7. What to show in the 4-minute demo

Matches the script in `product.md`:

1. **Problem (30 s):** "A small claim costs about $17 of adjuster time to handle. Most of them need no person."
2. **Live (2 min):** cracked-screen claim with the IMEI photo, approved with the checks shown. Stolen-phone claim with a police report whose name and IMEI match the policy, approved under the lower theft cap. A car collision with injury routed ("never auto-approved") if time allows.
3. **Fraud moment (30 s):** same photo again, routed with the reason naming `CLM-1042`.
4. **Impact (30 s):** impact panel and one claim's agent trace, then the value table (base $1.09M, conservative $0.30M per 100,000 claims).
5. **Next steps (30 s):** pilot in shadow mode, police report verification, payment, policy PDF ingestion, more tenants.

## 8. Decisions made

| # | Decision | Result |
|---|---|---|
| 1 | Agent design | **Option C.** Investigator agent on AgentCore Runtime, read-only tools through AgentCore Gateway with an Interceptor, decision in code outside the agent. Fixed pipeline is the fallback if latency is too high. |
| 2 | Async submit | **SQS with a DLQ.** 202 and polling. The DLQ routes the claim to an adjuster. |
| 3 | Tools | Read-only tools via Gateway with IAM inbound auth and a signed job ticket per claim. No token passthrough. The Decision Lambda is private and holds the only decision-write permission. |
| 4 | Event bus | Deferred to the pilot. |
| 5 | Tenancy | `tenantId` in all keys, from the JWT. Sharded queue index. One tenant for the MVP. |
| 6 | Thresholds | SSM for the kill switch and global defaults. Caps per category and cause in claim type packs. Values copied into the audit record. |
| 7 | Pilot controls | Shadow mode, QA sampling, override analytics are pilot items. The kill switch is in the MVP. |
| 8 | Observability | AgentCore Observability and CloudWatch baseline plus the console impact panel. CloudWatch Omni is a stretch goal. |
| 9 | Region and model | us-east-1. Claude Haiku 5.5 with prompt caching and `maxTokens` limits. |
| 10 | Compute | Lambda. Fargate is a later option behind the same queue. EC2 not recommended. |
| 11 | Latency target | p50 about 4 s, p95 up to 6 s. |
| 12 | Evidence upload | Presigned POST direct to S3. Metadata only through the API. |
| 13 | Auto-approve caps | Starting values: phone damage $500, phone theft $300, car windscreen $250, everything else $0. To be tuned in shadow mode. |
| - | Demo scope | Phones (damage and theft) and cars (low severity only). Health bills out of scope. |

## 9. Still open

1. Account checks: Bedrock quotas for Haiku 5.5, AgentCore Runtime, Gateway and interceptor availability in us-east-1, Lambda concurrency quota.
2. Global or US geo inference profile for Haiku 5.5 (10% price difference, data routing).
3. Whether the happy path stays within p50 about 4 s and p95 up to 6 s after the first build. Per-stage metrics will show where the time goes.
4. Real inputs for the value model from a design partner. Until then the numbers are labelled assumptions with the published results in `docs/value-model.md` as context.
5. Primary sources for the secondary-source figures (Aviva savings, Lemonade ratios) before the pitch.
