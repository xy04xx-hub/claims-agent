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
2. **Claims chat:** the customer describes what happened and uploads a photo.
3. **Claims agent:**
   - checks coverage, limit and deductible
   - runs fraud checks: same photo used before, claim very soon after policy start, amount far above the item's typical value, many claims in a short time
   - **auto-approves only small, clean claims below a threshold, enforced in code**
   - routes everything else to an adjuster queue with the reasons
4. **Adjuster console:** queue of routed claims, evidence, approve/reject.

## Claim scope and coverage

**Scope:** the agent handles any item category defined in a customer's policy, not only mobile phones. The demo seed data covers phones (the demo claim), plus a few other categories (for example laptop, bicycle, camera) so the coverage checks are visible. The stolen phone is only the demo scenario.

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
| Covered, under threshold, no fraud signals | `AUTO_APPROVED` |
| Not covered or coverage unclear | `ROUTED_TO_ADJUSTER` with coverage reason |
| Over threshold or over limit | `ROUTED_TO_ADJUSTER` |
| Any fraud signal (including duplicate photo) | `ROUTED_TO_ADJUSTER` with signal reason |
| Error or timeout | `ROUTED_TO_ADJUSTER` |

## Users and roles

- **Customer:** files claims, sees only their own claims.
- **Adjuster:** sees the routed queue and evidence, approves or rejects.

## Demo script (about 4 minutes)

1. **Problem (30 s):** "Claims take weeks. Most small ones don't need a person at all."
2. **Live (2 min):** a judge files a claim for a stolen phone with a photo. Approved in seconds, with the policy checks shown.
3. **Fraud moment (30 s):** the judge files a second claim with the same photo. Routed to an adjuster with the reason "Photo matches claim CLM-1042 from last week."
4. **Result (30 s):** value slide.
5. **Next steps (30 s):** payment integration, more fraud signals, a voice channel.

Demo implications for the build:
- The happy path must complete in seconds. No long waits.
- Seed data must include a policy for the demo customer and a prior claim `CLM-1042` with a photo, so the duplicate-photo reason can name it.
- Seed policy must cover the phone but leave at least one category or cause uncovered, so a "not covered, routed with reason" case can be shown if a judge asks.
- The decision screen must show the policy checks that passed.

## Value model (assumptions to fill in)

- **Adjuster time saved** = claims per month × share auto-handled × minutes per claim × adjuster hourly cost
- **Cycle time** = days to settle before vs seconds after, for auto-handled claims
- **Fraud caught** = flagged claims × average fraudulent amount

Keep the assumptions in one documented place (for example `docs/value-model.md`) so the numbers on the value slide trace back to inputs.

## Expected judge questions

- **"What if the AI approves a fraudulent claim?"** Only claims below a small threshold with no fraud signals are auto-approved. Everything else goes to a person, as Lemonade describes its own approach.
- **"Isn't this regulated?"** Yes. That is why the agent's only decision is "automatic or human," and every decision is logged for audit.

- **"What if the company changes a policy, for example stops covering stolen phones?"** Policies are versioned structured records read at claim time. The change applies to the next claim with no redeploy. Each claim is judged on the version in force on the loss date, and the audit log records that version.
- **"What about real policy PDFs with tables and charts?"** Next step. Bedrock multimodal extraction writes a draft structured policy, a person reviews it, and it is saved as a new version. Decisions never depend on text retrieval.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Insurance feels distant from our clients | Frame as "instant approvals within policy". The same pattern applies to warranty claims, returns and expense claims. |
| Image checks unreliable | Use exact/near-duplicate hashing for the fraud demo, not model judgment. |
| Regulatory questions | Keep the human-in-the-loop design front and centre. |
