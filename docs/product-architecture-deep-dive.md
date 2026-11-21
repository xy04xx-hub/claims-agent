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

## 3. Value model with worked numbers

**Every input below is an assumption to replace with the design partner's data.** Sources for the context are in section 2. The point is that the numbers trace to inputs, as the judging criteria require.

Reference customer: a mid-size device, renters or travel insurer, 100,000 claims a year.

| Input | Conservative | Base | Source |
|---|---|---|---|
| Claims per year | 100,000 | 100,000 | assumption |
| Share auto-handled | 20% | 40% | assumption. Lemonade reports about 55% after years of tuning, so 20 to 40% is realistic for an MVP threshold |
| Adjuster minutes per claim saved | 15 | 25 | assumption, validate with time study |
| Loaded adjuster cost per hour | $35 | $40 | assumption |
| Share of claims flagged by fraud signals | 2% | 3% | assumption. The NICB 10% figure is all fraud elements, we catch only rule-detectable ones |
| Share of flagged claims confirmed fraudulent | 25% | 40% | assumption |
| Average fraudulent claim | $250 | $350 | assumption |

| Result per year | Conservative | Base | Formula |
|---|---|---|---|
| Adjuster time saved | **$175,000** | **$666,667** | claims x auto share x (minutes / 60) x hourly cost |
| Hours saved | 5,000 h | 16,667 h | claims x auto share x minutes / 60 |
| Fraud paid out and avoided | **$125,000** | **$420,000** | claims x flagged share x confirmed share x average fraud amount |
| **Total benefit** | **$300,000** | **$1,086,667** | sum |
| Platform variable cost | about $5,000 | about $5,000 | assumed at most $0.05 per claim for Bedrock, Lambda, DynamoDB. Replace with the figure from `docs/cost-estimate.md` after checking current Bedrock pricing |

- Cost per manually handled small claim in the base case is 25 min x $40/h = **$16.67**. The agent handles an eligible claim for cents.
- Cycle time: auto-handled claims go from the carrier's current settlement time (measure it in discovery) to seconds. The demo shows the seconds side live.
- Honest caveat on fraud: "caught" means routed to a person and not auto-paid. Humans may have caught some of these eventually. The gain is earlier detection and no automatic payment, so the fraud line is the softer number.
- Commercial hypothesis: a per-auto-handled-claim fee at 10 to 15% of the $16.67 saving is about $2 per claim. Test this in discovery.

## 4. User journeys

### 4.1 Customer: covered, small, clean claim (target under 5 seconds from submit)

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

1. The Orchestrator Lambda starts an **Investigator agent on AgentCore Runtime** (Bedrock Converse tool use). The agent calls **read-only tools through AgentCore Gateway** in parallel: `lookup_policy`, `check_fraud_signals`, `verify_evidence`.
2. The agent returns a schema-validated **proposal**: extracted fields (item, cause from the fixed list, amount, loss date, identifiers), an evidence assessment with confidence, and a draft explanation.
3. The Orchestrator then calls `approve_within_limit` or `route_to_adjuster` itself. These functions are **not exposed to the model**. They re-fetch the policy, pack, signals and identifiers and do not trust the proposal's statements about data.

Why this shape: the agent does the work where reasoning helps (reading messy evidence, reconciling fields). Code does the work where guarantees matter. Gateway tools can later serve an adjuster copilot and other agents, and AgentCore Observability traces every model and tool call. Expected happy-path latency is about 3 to 6 s with parallel tool calls. Check it before every rehearsal. If it is too slow, fall back to a fixed pipeline: the model extracts once and code calls the same Lambdas directly.

### 5.2 Asynchronous submit with status polling (decided)

- `POST /claims` validates input, writes the claim as `PROCESSING`, and returns `202` with the claim ID in under a second. The Lambda continues, or hands off through an async invoke or SQS.
- The console polls `GET /claims/{id}` until the status is final. On the fast path this finishes in seconds, so the demo looks the same.
- This removes the 30 s API timeout risk, gives a natural place for retries, and lets Bedrock throttling queue instead of fail. Streaming is not needed for the MVP.
- Idempotency: the client sends a `clientRequestId`. A conditional DynamoDB write prevents a retry from creating or approving a claim twice.

### 5.3 Keep separate Lambdas, because they are the security boundary

The extra Lambdas add a network hop and cold start. Keep them for one reason: **only `approve_within_limit` and `route_to_adjuster` hold IAM permission to write a decision status.** The Investigator's role is read-only and cannot write `AUTO_APPROVED`, even if its code or prompt is compromised. This is the structural defence against prompt injection that the engineering rules call for. Document it in the CDK stack, and add the required test that no path reaches approval above the limit or with a fraud signal.

Latency mitigation: provisioned concurrency is not serverless-cheap, so use small Node.js or Python bundles without heavy dependencies, and compute photo hashes at upload time (5.5), not at decision time.

### 5.4 Event bus (deferred)

An event on every decision would let payment, notification and analytics react without changing the agent. It is not needed for the MVP. DynamoDB Streams provide the same hook when the pilot needs it.

### 5.5 Evidence and fraud pipeline

- Browser uploads photos and documents with a presigned PUT. Limit type (JPEG, PNG, PDF) and size in the presign conditions.
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
| 1 | Agent design | **Option C.** Investigator agent on AgentCore Runtime, read-only tools through AgentCore Gateway, decision in code outside the agent. Fixed pipeline is the fallback if latency is too high. |
| 2 | Async submit | Yes. 202 and polling, client request ID for idempotency. |
| 3 | Tools | Read-only tools via Gateway. Decision functions are private and hold the only decision-write permission. |
| 4 | Event bus | Deferred to the pilot. |
| 5 | Tenancy | `tenantId` in all keys, from the JWT. Sharded queue index. One tenant for the MVP. |
| 6 | Thresholds | SSM for the kill switch and global defaults. Caps per category and cause in claim type packs. Values copied into the audit record. |
| 7 | Pilot controls | Shadow mode, QA sampling, override analytics and the kill switch are pilot items. The kill switch is in the MVP. |
| 8 | Observability | AgentCore Observability and CloudWatch baseline plus the console impact panel. CloudWatch Omni is a stretch goal. |
| - | Demo scope | Phones (damage and theft) and cars (low severity only). Health bills out of scope. Theft can auto-approve with a matching police report, under a lower cap. |

## 9. Still open

1. AWS Region and Bedrock model, including AgentCore Runtime, Gateway and Observability availability in that Region. Not verified yet.
2. Auto-approve caps per category and cause.
3. Whether the agent's happy-path latency meets the target after the first build.
4. Real inputs for the value model from a design partner.
