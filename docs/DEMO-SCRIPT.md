# Demo script (4 minutes)

Console: `https://dqgqnillqzhh8.cloudfront.net` (dev-a). Logins are in `docs/DEMO-CREDENTIALS.local.md` (git-ignored, not in the repo).

## Before you record (5 minutes)

1. Reset the data: `npx tsx scripts/cleanup-demo-data.ts --stage dev-a`. The adjuster queue must read "No claims waiting for review".
2. Warm the Lambdas: `E2E_CUSTOMER_PASSWORD=... SEED_TENANT_ID=t1 npx tsx scripts/e2e-claim-flow.ts --stage dev-a --scenario A --cleanup`, then run the cleanup script again. The first claim after idle takes about 9 s, warm claims about 6 s.
3. Open two browser windows: window 1 for the customer, window 2 (private window) for the adjuster, both at the console URL.
4. Have the evidence files ready from `seed/evidence/`: `phone-damaged-imei1.png` (scenario A) and `police-report-phone2.png` (scenario H). Keep this file open for the numbers.

## 0:00 Problem (30 s)

Say: "Insurance claims take days or weeks. Most small claims are clean and rule-checkable, but they wait in the same queue as complex ones. Our agent checks the claim against the policy and fraud rules, pays small clean claims in seconds, and sends everything else to a person with the reasons. The AI never pays a claim by itself above the limit, and it never rejects one. Code makes the decision, the model only proposes."

Show: the console sign-in page.

## 0:30 Live demo (2 min)

### Scenario A: approved in seconds (60 s)

1. Window 1: click **Sign in**, enter `customer1@example.com` and the customer password.
2. Point at **My policies**: POL-001, the phone and the car.
3. In **File a claim**: Item = the phone with IMEI ending 3809 (ITEM-PHONE-1), cause = accidental damage, amount `180`, loss date `15 Nov 2026`, description "Dropped my phone, screen cracked."
4. Choose file `phone-damaged-imei1.png` (the About phone screen showing the IMEI). Click **Submit claim**.
5. After about 6 s the panel shows **Approved, Payout 130.00** and the passed checks (policy active, category and cause covered, evidence matches policy, under cap, no risk signals).
6. Say: "The model read the IMEI from the photo. Code compared it with the IMEI on the policy, checked the cap and the fraud signals, then approved. The 50 dollar deductible is applied."

### Scenario H: routed, AI reads the police report (60 s)

1. Same window, new claim: Item = the second phone (ITEM-PHONE-2), cause = theft, amount `300`, loss date `15 Nov 2026`, description "Phone stolen on the train."
2. Choose `police-report-phone2.png`. Click **Submit claim**.
3. After about 6 s the panel shows **Needs review** with the message that a person will review the claim.
4. Say: "The model read the IMEI, name and dates from the police report. Code found that this IMEI was already claimed on CLM-1042 last month. That is a fraud signal, so the claim goes to a person. It is never auto-rejected."

## 2:30 Adjuster approves (30 s)

1. Window 2: click **Sign in**, enter `adjuster1@example.com` and the adjuster password.
2. The **Review queue** lists the H claim with the reason "Identifier ...0017 was already claimed on CLM-1042."
3. Click **Evidence ...** to open the police report (a 60 s presigned link).
4. Click **Approve**. The notice shows "approved" and the claim leaves the queue.
5. Say: "Only an adjuster can approve a routed claim. The decision and the actor go to the audit log."

## 3:00 Result (30 s)

Numbers from `docs/value-model.md` (assumptions for a reference insurer with 100,000 claims a year):

- Conservative case: 20% auto-handled, 15 min saved per claim: **5,000 hours** and **$175,000** of adjuster time a year, **$300,000** total benefit with fraud avoided.
- Base case: 40% auto-handled, 25 min saved per claim: **16,667 hours (about 8 full-time adjusters)** and **$666,667** of adjuster time a year, **$1.09 million** total benefit.
- A manually handled small claim costs about $16.67. Our model cost is about **$0.01 to $0.02 per claim**, and the whole platform about $167 a month at pilot volume (`docs/cost-estimate.md`).
- Cycle time: days down to seconds for auto-handled claims.

## 3:30 Next steps (30 s)

Say: "Next: move the tool calls behind AgentCore Gateway with an Interceptor, so every tool call is limited to one claim by a KMS-signed job ticket the model cannot see. Add car insurance by VIN, using the same claim type packs. Try Nova 2 Lite to cut the model cost by more than half. Then run in shadow mode at a pilot insurer to tune the caps and add police report verification."

## Fallback if the console fails

Use the script and the AWS consoles. Same flow, same data.

1. Customer side, in a terminal:
   ```bash
   E2E_CUSTOMER_PASSWORD=<customer password> SEED_TENANT_ID=t1 npx tsx scripts/e2e-claim-flow.ts --stage dev-a --cleanup
   ```
   It signs in, uploads the evidence, files scenarios A and H, polls, and prints `PASS scenario A: status AUTO_APPROVED ... payout 130` and `PASS scenario H: status ROUTED_TO_ADJUSTER ... adjuster reasons: ["Identifier ...0017 was already claimed on CLM-1042."]`. Drop `--cleanup` to keep the claims for the next steps.
2. DynamoDB console (us-east-1, Tables): open `ClaimsAgent-dev-a-Foundation-ClaimsTable...`, **Explore items**, find the new claim `t1#CLM-...`. Show `status`, `decision.checksPassed`, `decision.reasons`.
3. Audit trail: table `ClaimsAgent-dev-a-Foundation-AuditLogTable...`, same claim ID: outcome, checks, risk signals, actor, model and prompt version.
4. CloudWatch console, Logs, Log groups: `ClaimsAgent-dev-a-Processing-workerLogGroup...` (agent run, `TotalMs`) and `ClaimsAgent-dev-a-Processing-decisionLogGroup...` (decision). Logs carry `claimId` and a request ID, no personal data.
5. Adjuster approval without the UI: call `POST /claims/{claimId}/resolution` with an adjuster access token and body `{"decision":"APPROVE","reasonCode":"VERIFIED_OK","note":"Checked report."}`.
6. After the demo, clean up: `npx tsx scripts/cleanup-demo-data.ts --stage dev-a`.
