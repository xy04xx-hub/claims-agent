# T-11: Domain package: packs, coverage and decision rules, tests

| Field | Value |
|---|---|
| Owner | A |
| Milestone | M1 |
| Depends on | T-02 |
| Judging items | SEC5, OE3, BIZ-C |
| Estimate | 4 h |
| Status | Todo |
| Branch | `a/T-11-domain` |

## Why

The decision is deterministic code. This package is the single implementation used by the tools and the Decision Lambda.

## Tasks

- [ ] `backend/domain`: types generated from `contracts/` (or hand-written and tested against the schemas).
- [ ] Pure functions with no AWS calls: `selectPolicyVersion(policy, lossDate)`, `checkCoverage(policy, item, cause)`, `computePayout(amount, deductible, limit)`, `evaluateSignals(inputs, thresholds)`, `decide(facts, pack, thresholds, killSwitch)` returning the `decision.json` shape with every check and reason.
- [ ] Claim type pack model with per-cause cap, required evidence, identifiers, typical values, confidence thresholds.
- [ ] Reason texts: customer-safe text and adjuster text for every failure (for example duplicate photo names `CLM-1042` only in the adjuster text).
- [ ] **Required test (steering rule):** a property-based test (fast-check) that `decide` never returns `AUTO_APPROVED` when the payout is above the cap, any risk signal is present, coverage fails, required evidence is missing, the cause is `UNCLEAR`, or the kill switch is off, whatever the proposal says.
- [ ] Unit tests for each demo scenario (A to G).

## Acceptance criteria

- [ ] 100% branch coverage on `decide` and `checkCoverage`.
- [ ] The property-based test runs at least 1,000 cases per property.

## Verification

- [ ] `vitest run backend/domain --coverage` passes with the coverage threshold enforced in config.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
