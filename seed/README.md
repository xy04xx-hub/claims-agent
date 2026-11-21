# seed

Owner: A. Synthetic seed data and evidence files. No real personal, financial or device data.

## Seed a stage

```bash
npm run seed -- --stage dev-a
```

Needs AWS credentials and a deployed Foundation stack. The script reads the table and bucket names from CloudFormation
and writes, with unconditional puts and fixed keys (so running it twice gives the same data):

| Table | Items |
|---|---|
| Policies | `POL-001` v1 and v2 |
| ClaimTypePacks | `phone`, `car`, `laptop` |
| EvidenceIndex | rows for `CLM-1042` (SHA256, PHASH, IDENTIFIER) and for every scenario claim |
| Claims | `CLM-1042` |

It also uploads the `CLM-1042` photo to the evidence bucket. Everything is under tenant `demo-insurer`, customer `cust-demo`.

## Run the demo scenarios

```bash
npx tsx scripts/run-scenarios.ts --stage dev-a
```

Needs the Processing stack. It resets the `CLM-SCN-*` claims to `PROCESSING`, invokes the deployed Decision Lambda
for each scenario and prints PASS or FAIL. It never writes the EvidenceIndex, Policies or ClaimTypePacks tables.
Scenarios use loss date `2026-11-15`, so run it on or after that date.

| ID | Case | Expected |
|---|---|---|
| A | Phone damage, 180 | AUTO_APPROVED, payout 130 |
| B / B2 | Phone theft 300 / 400 | approved, payout 250 / routed (above the theft cap) |
| C / CI / C2 | Car collision / injury / windscreen | routed (cap 0) / routed / approved |
| D | Photo of `CLM-1042` | routed, names `CLM-1042` |
| E | Laptop theft | routed, category not covered |
| E2 | Phone loss under policy v2 | routed, cause not covered |
| F | Phone damage 700 | routed, above the cap |
| G | Report IMEI differs from the policy | routed, evidence mismatch |
| H | Theft on an IMEI already claimed on `CLM-1042` | routed, identifier reuse |

Policy v2 drops phone `LOSS` and keeps `THEFT`, so live theft claims with a current date work.

## Change the data

- Definitions are in `seed/definitions/`. They import no AWS code.
- Evidence files: `npx tsx seed/tools/generate-evidence.ts` (see `seed/evidence/README.md`).
- The perceptual hash in `seed/lib/hashing.ts` must match the Evidence Processor (T-13).
