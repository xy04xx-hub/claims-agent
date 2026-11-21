# Design: T-02 Contracts

## Layout (`contracts/`)
- `api/<route>.<request|response>.schema.json` and `.example.json`: me-policies, evidence-upload, claim-create, claim-get, claims-list (used by `GET /claims` and `GET /queue`), evidence-get, resolution, impact, error.
- `job-message`, `proposal`, `decision`, `audit-record`: schema + example each.
- `tools/<tool>.<input|output>.schema.json` + example for `lookup_policy`, `check_fraud_signals`, `verify_evidence`.
- `job-ticket.md`, `data-model.md`, `VERSION` (1.0.0).
- `contracts.test.js`, `package.json` (ajv, ajv-formats).

## Decisions
- Schemas use `additionalProperties: false` and bounded strings and arrays.
- Tool inputs have no claim or customer ID. `lookup_policy` and `check_fraud_signals` take `{}`. `verify_evidence` takes the fields extracted from evidence.
- `decision.schema.json` uses `if/then/else`: an `AUTO_APPROVED` outcome allows no failed checks and no risk signals, and a routed outcome requires payout 0.
- `proposal.model` and `audit-record.model` are plain strings. Examples use `global.anthropic.claude-haiku-4-5-20251001-v1:0`.
- `data-model.md` defines Policies, Claims (GSIs `byCustomer`, `byQueue` with 8 shards, `byRequest`), EvidenceIndex, ClaimTypePacks and AuditLog.

## Test
`contracts.test.js` (node:test + Ajv 2020) checks that each `*.schema.json` has an example that validates, and that no example lacks a schema.
