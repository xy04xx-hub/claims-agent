# Requirements: T-11 Domain package

Source: `docs/plan/tickets/T-11-domain.md`. Scope is the ticket's scope.

## User story
As the claims engine, I want one pure, tested implementation of coverage, signals and the decision, so that the tools and the Decision Lambda decide the same way and the model can never cause an approval.

## Acceptance criteria (EARS)

1. THE SYSTEM SHALL provide `backend/domain` as a package with no AWS calls.
2. WHEN a loss date is given, THE SYSTEM SHALL select the policy version in force on that date (`selectPolicyVersion`).
3. WHEN coverage is checked, THE SYSTEM SHALL verify policy active on the loss date, item on policy, category covered and cause covered (`checkCoverage`), and report a specific reason for each failure.
4. WHEN a payout is computed, THE SYSTEM SHALL subtract the deductible, never go below zero, and report whether it is within the limit (`computePayout`).
5. WHEN signals are evaluated, THE SYSTEM SHALL detect duplicate photo, identifier reuse, early claim, amount outlier, claim frequency, timeline inconsistency and failed lookup (`evaluateSignals`).
6. WHEN `decide` runs, THE SYSTEM SHALL return the `decision.json` shape with every check, signal and reason.
7. IF the payout is above the cap, any risk signal is present, coverage fails, required evidence is missing or inconsistent, the cause is `UNCLEAR`, or the kill switch is off, THEN THE SYSTEM SHALL return `ROUTED_TO_ADJUSTER`, whatever the proposal says.
8. WHEN a claim is routed, THE SYSTEM SHALL provide customer-safe text and adjuster text, and name other claims (for example `CLM-1042`) only in the adjuster text.
9. THE SYSTEM SHALL model a claim type pack with per-cause cap, required evidence, identifiers, typical value and confidence threshold.
10. WHEN the demo scenarios A to H are run through `decide`, THE SYSTEM SHALL give the expected outcome for each.
11. THE SYSTEM SHALL reach 100% branch coverage on `decide` and `checkCoverage`, enforced by coverage config.
12. THE SYSTEM SHALL run the never-approve property test with at least 1,000 cases per property.
