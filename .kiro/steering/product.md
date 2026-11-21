# Instant Claims Agent: Product Ground Truth

This file and the other steering files in this folder are the source of truth for the project. If code or a proposal conflicts with them, raise it with the user before deviating.

**One line:** an AI agent that checks an insurance claim against the policy and fraud rules, pays small clean claims in seconds, and routes everything else to a human adjuster with the reasons.

## Problem

Insurance claims often take days or weeks: paperwork, manual checks against the policy, and fraud review. Most small claims are straightforward, but they wait in the same queue as complex ones. That costs adjuster time and frustrates customers.

## Design principle

The AI makes exactly one decision: **handle this claim automatically, or hand it to a human.** It does not blindly pay every claim. This follows Lemonade's published approach.

References:
- https://www.lemonade.com/blog/lemonade-sets-new-world-record/ (theft claim paid in about 3 s, 18 anti-fraud checks)
- https://www.claimsjournal.com/news/east/2017/01/13/276202.htm
- https://blog.lemonade.com/blog/secret-behind-lemonades-instant-insurance/ (one decision: automatic or human)
- https://insurancenewsnet.com/innarticle/insurtech-lemonade-sets-record-on-claims-processing-but-not-on-profit (about 2 s)

## What we build

1. **Policies and claims history** in our own DynamoDB: coverage types, limits, deductibles, policy start dates, past claims.
2. **Guided claim intake:** the customer describes what happened and uploads the evidence the claim type requires (for example a photo showing the IMEI, or a police report). The console reads the required evidence from the claim type pack.
3. **Claims agent:** an investigator agent reads the policy, the customer's plan and the evidence through read-only tools and proposes. Code decides.
   - checks coverage, limit and deductible
   - checks the evidence against the system of record: the IMEI or VIN on the photo or report must match the insured item, the name must match the policyholder, dates must be consistent
   - runs fraud checks: same photo or identifier used before, claim very soon after policy start, amount far above the item's typical value, many claims in a short time
   - **auto-approves only small, clean claims below a cause-specific cap, enforced in code**
   - routes everything else to an adjuster queue with the reasons
4. **Adjuster console:** queue of routed claims, evidence, approve/reject.

## Claim scope and coverage

**Scope:** the agent handles any category defined in a tenant's claim type packs, not only mobile phones. Adding a category or a tenant is configuration, not code. The demo covers **mobile phones** (accidental damage and theft) and **cars** (low-severity claims only), plus an uncovered category so the coverage check is visible.

**User input is not ground truth.** The decision uses the system of record: the policy and plan, the insured item identifiers, claim history and evidence hashes. The claimant's text, amount and files must be corroborated against it. What the model reads from a photo or document is a signal, never an approval.

**Evidence by claim type (demo packs):**

| Claim | Evidence required | Auto-approval |
|---|---|---|
| Phone, accidental damage | Photo of the damaged device showing the IMEI | Below the damage cap |
| Phone, theft | Police report. Name, IMEI or serial and dates must match the policy. The IMEI must not have been claimed before. | Below a lower theft cap, with a higher QA sampling rate |
| Car, windscreen or minor cosmetic | Photo showing the plate | Below a small cap |
| Car, collision, injury, third party, theft, total loss | Incident or police report | Never. Always routed. |

Matching a police report to the policy proves consistency, not authenticity. A forged report that copies the policyholder's details would pass. That is why theft has a lower cap and more audit sampling, and why report verification with the issuing authority is a pilot item.

**Coverage check (deterministic, in `lookup_policy` and re-checked in `approve_within_limit`):** a claim is covered only if all of these hold:
- the policy is active on the loss date
- the item category is listed on the policy
- the cause of loss (for example theft, accidental damage, loss) is covered for that category
- the amount after the deductible is within the category limit

**Not covered or unclear:** the agent never auto-approves and never auto-rejects. The claim is routed to an adjuster with a specific reason, for example "Item category 'laptop' is not covered by policy POL-001" or "Cause 'water damage' is not covered for 'phone'". The customer is told the claim needs review and why. Only an adjuster can reject. This keeps the single decision "automatic or human" and avoids automated denials, which carry regulatory risk.

**Duplicate photos are one fraud signal, not the only rule.** A duplicate or near-duplicate photo routes the claim to an adjuster with the matching claim ID. It does not block the claim. The other signals (early claim, amount outlier, claim frequency) and the coverage checks above work the same way: any failure routes to a person.

**Outcomes summary:**

| Situation | Outcome |
|---|---|
| Covered, evidence matches the policy, under the cap, no risk signals | `AUTO_APPROVED` |
| Required evidence missing, unreadable or inconsistent with the policy | `ROUTED_TO_ADJUSTER` with the mismatch reason |
| Not covered or coverage unclear | `ROUTED_TO_ADJUSTER` with coverage reason |
| Over threshold or over limit | `ROUTED_TO_ADJUSTER` |
| Any fraud signal (including duplicate photo) | `ROUTED_TO_ADJUSTER` with signal reason |
| Error or timeout | `ROUTED_TO_ADJUSTER` |

## Users and roles

- **Customer:** files claims, sees only their own claims.
- **Adjuster:** sees the routed queue and evidence, approves or rejects.

## Demo script (about 4 minutes)

1. **Problem (30 s):** "Claims take weeks. Most small ones don't need a person at all."
2. **Live (2 min):**
   - a judge files a cracked-screen claim with a photo showing the IMEI. Approved in seconds, with the policy and evidence checks shown.
   - a stolen-phone claim with a police report. The checks show the name and IMEI matched the policy. Approved under the lower theft cap.
   - if time allows, a car collision with injury is routed to an adjuster ("never auto-approved").
3. **Fraud moment (30 s):** the judge files a second claim with the same photo. Routed to an adjuster with the reason "Photo matches claim CLM-1042 from last week."
4. **Impact (30 s):** the console impact panel shows auto-handle rate, latency and estimated hours and dollars saved. Then the value slide (`docs/value-model.md`).
5. **Next steps (30 s):** pilot in shadow mode, police report verification, payment integration, policy PDF ingestion, more tenants.

Demo implications for the build:
- The happy path must complete in seconds. No long waits.
- Seed data must include a policy for the demo customer and a prior claim `CLM-1042` with a photo, so the duplicate-photo reason can name it.
- Seed policy must cover the phone but leave at least one category or cause uncovered, so a "not covered, routed with reason" case can be shown if a judge asks.
- Seed data must include the insured phone's IMEI and the car's plate on the policy, a synthetic damaged-phone photo showing the IMEI, and a synthetic police report whose name and IMEI match the policy. All synthetic.
- The console shows a live impact panel and the AgentCore or CloudWatch trace for one claim, so the audience sees every model and tool call.
- The decision screen must show the policy checks that passed.

## Value model

Worked numbers and sources are in `docs/value-model.md`. Formulas:

- **Adjuster time saved** = claims per month × share auto-handled × minutes per claim × adjuster hourly cost
- **Cycle time** = days to settle before vs seconds after, for auto-handled claims
- **Fraud caught** = flagged claims × average fraudulent amount

Keep the assumptions in one documented place (for example `docs/value-model.md`) so the numbers on the value slide trace back to inputs.

## Expected judge questions

- **"What if the AI approves a fraudulent claim?"** Only claims below a small threshold with no fraud signals are auto-approved. Everything else goes to a person, as Lemonade describes its own approach.
- **"Isn't this regulated?"** Yes. That is why the agent's only decision is "automatic or human," and every decision is logged for audit.

- **"Are you trusting what the customer uploads?"** No. The customer's claim and files are checked against the policy: the device identifier, the policyholder name and the dates must match, the photo and IMEI must not have been used before, and the model's reading of an image or document is only a signal. Anything unverified routes to a person.
- **"What about fake or AI-generated photos and forged reports?"** We cannot prove authenticity automatically, and we say so. The defence is layered: low caps (lower for theft), identifier reuse checks, several independent signals, random audits of auto-approvals, and a kill switch. The roadmap adds provenance checks and report verification with the issuing authority.
- **"Does this work for other insurers or products?"** Yes. A claim type pack defines causes, required evidence, caps and identifiers per tenant and category. Adding one is data. Each tenant's data is isolated by `tenantId`.
- **"What if the company changes a policy, for example stops covering stolen phones?"** Policies are versioned structured records read at claim time. The change applies to the next claim with no redeploy. Each claim is judged on the version in force on the loss date, and the audit log records that version.
- **"What about real policy PDFs with tables and charts?"** Next step. Bedrock multimodal extraction writes a draft structured policy, a person reviews it, and it is saved as a new version. Decisions never depend on text retrieval.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Insurance feels distant from our clients | Frame as "instant approvals within policy". The same pattern applies to warranty claims, returns and expense claims. |
| Image checks unreliable | Use exact/near-duplicate hashing and identifier matching for the fraud demo. Model reading of images is a signal that can only route. |
| Forged documents or AI-generated images | Lower caps for theft, identifier reuse check, audit sampling, kill switch. Pilot adds provenance and report verification. |
| Regulatory questions | Keep the human-in-the-loop design front and centre. |
