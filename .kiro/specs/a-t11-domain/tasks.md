# Tasks: T-11 Domain package

- [x] 1. Create `backend/domain` with types matching `contracts/`
- [x] 2. `selectPolicyVersion`, `checkCoverage`, `computePayout`
- [x] 3. `evaluateSignals` with all seven signals
- [x] 4. `decide` returning the `decision.json` shape
- [x] 5. Claim type pack model (caps, evidence, identifiers, typical value, confidence)
- [x] 6. Customer-safe and adjuster reason texts for every failure
- [x] 7. Unit tests for every rule and boundary
- [x] 8. Tests for demo scenarios A to H
- [x] 9. Never-approve test (cap, risk signals, coverage, evidence, `UNCLEAR`, kill switch), table-driven
- [x] 10. Run the tests: `npm test -w backend/domain` (65 passed)
- [ ] 11. Property-based test with fast-check, 1,000 cases per property (skipped for hackathon MVP)
- [ ] 12. Coverage threshold in config, 100% branches on `decide` and `checkCoverage` (skipped for hackathon MVP)
- [ ] 13. Verification: `vitest run backend/domain --coverage` (skipped for hackathon MVP)
