# T-12: Synthetic seed data and seed script

| Field | Value |
|---|---|
| Owner | A |
| Milestone | M1 |
| Depends on | T-05, T-11 |
| Judging items | BIZ-C, BIZ-P |
| Estimate | 3 h |
| Status | Todo |
| Branch | `a/T-12-seed` |

## Why

The demo depends on exact seed data, and every environment must be rebuildable from it.

## Tasks

- [ ] `scripts/seed.ts --stage <stage>`: idempotent upserts. Reads table and bucket names from stack outputs.
- [ ] Tenant `demo-insurer`. Customers linked to the seeded Cognito users (T-06).
- [ ] Policies: `POL-001` v1 and v2 (v2 removes a cause, to show versioning), phone with IMEI and car with plate on the policy, deductibles and limits.
- [ ] Claim type packs with the caps from `architecture.md` (phone damage $500, phone theft $300, car windscreen $250, others $0).
- [ ] Prior claim `CLM-1042` with a photo and its hashes in `EvidenceIndex` (for the duplicate-photo moment).
- [ ] Synthetic evidence files in `seed/evidence/`: damaged-phone photo showing a fake IMEI, a police report image with matching name and IMEI, one with a mismatching IMEI, one photo of a non-phone object. All generated or self-made, no real personal data.
- [ ] Typical-value table for the outlier check.

## Acceptance criteria

- [ ] Running the script twice gives the same data.
- [ ] Every demo scenario has the data it needs.

## Verification

- [ ] Run seed twice, then count rows per table: unchanged.
- [ ] `aws dynamodb get-item` for `CLM-1042` returns it with its photo hash.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
