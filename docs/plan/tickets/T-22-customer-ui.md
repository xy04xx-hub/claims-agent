# T-22: Customer claim flow UI

| Field | Value |
|---|---|
| Owner | B |
| Milestone | M2 |
| Depends on | T-09, T-21 |
| Judging items | BIZ-C, BIZ-P, OE4, SEC5 |
| Estimate | 5 h |
| Status | Todo |
| Branch | `<A|B>/T-22-customer-ui` |

## Why

The judge files a claim live. It must be clear and fast.

## Tasks

- [ ] Pick policy and item, choose the cause; the form asks for the required evidence from `GET /me/policies`.
- [ ] Describe what happened (chat-style text box, max 1,000 chars with a counter) and the amount.
- [ ] Upload with the presigned POST, with client-side type and size checks and a progress bar.
- [ ] Submit with a generated `clientRequestId`, then a progress view (Received, Checking policy, Checking evidence, Decided) while polling.
- [ ] Decision screen: Approved with the payout and the list of passed checks, or Needs review with the customer-safe reason. Never shows internal fraud details.
- [ ] My claims list.

## Acceptance criteria

- [ ] Scenario A can be completed by a first-time user in under 1 minute.
- [ ] Decision screen shows the checks that passed (product requirement).

## Verification

- [ ] Run scenarios A, C and D in a dev stage and take screenshots for the PR.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
