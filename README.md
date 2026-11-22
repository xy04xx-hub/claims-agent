# Instant Claims Agent

An AI agent that checks an insurance claim against the policy and fraud rules, pays small clean claims in seconds, and routes everything else to a human adjuster with the reasons. The model proposes, code decides. Serverless on AWS (us-east-1), deployed with CDK. Product rules are in `.kiro/steering/`, the architecture in `.kiro/steering/architecture.md` and `docs/architecture.png`.

## Prerequisites

Node.js 22 (`.nvmrc`), AWS credentials for the target account, Chrome (only for the browser test). Then:

```bash
npm install
```

## Deploy

Stages are `dev-a`, `dev-b` and `demo` (config in `infra/config/<stage>.json`).

```bash
npm run deploy -- dev-a                  # all stacks
# or one stack:  cd infra && npx cdk deploy Processing -c stage=dev-a --exclusively
```

Stacks: Foundation, Auth, Api, Processing, Agent, Web, Ops. Never destroy a stack that holds demo data.

## Seed data and users

```bash
npm run seed-users -- dev-a                                   # Cognito users (customer1, customer2, adjuster1)
SEED_TENANT_ID=t1 SEED_CUSTOMER_ID=<sub of customer1> npm run seed -- --stage dev-a
npx tsx scripts/cleanup-demo-data.ts --stage dev-a            # remove claims filed through the API, keep seed data
```

The seed script is described in `seed/README.md`. Set a known password with `aws cognito-idp admin-set-user-password --permanent` and keep it in `docs/DEMO-CREDENTIALS.local.md` (git-ignored).

## Run the end-to-end check

Files scenario A (approved) and H (routed, IMEI already claimed on CLM-1042) through the deployed API as `customer1`:

```bash
E2E_CUSTOMER_PASSWORD=... SEED_TENANT_ID=t1 npx tsx scripts/e2e-claim-flow.ts --stage dev-a --cleanup
# options: --scenario A|H   --identifier-fallback (stand-in for image reading)
```

## Open the console

1. `npm run outputs -- dev-a` writes `frontend/.env.dev-a` from the stack outputs.
2. `STAGE=dev-a npm run build -w frontend` builds the console. The API URL, app client ID and Cognito domain come from that file, nothing is hardcoded.
3. `cd infra && npx cdk deploy Web -c stage=dev-a --exclusively` uploads it to CloudFront.
4. Open the `ConsoleUrl` output of `ClaimsAgent-dev-a-Web` and sign in (Cognito hosted UI). Customers file claims, adjusters work the queue.

The console origin must be listed in `consoleOrigins` of the stage config (API and evidence bucket CORS). Local development: `npm run dev -w frontend` serves http://localhost:5173.

Browser test of the deployed console (customer files A and H, adjuster approves H):

```bash
CONSOLE_URL=https://<distribution>.cloudfront.net E2E_CUSTOMER_PASSWORD=... E2E_ADJUSTER_PASSWORD=... node tests/e2e/console-ui.mjs
```

## Change thresholds

- Auto-approve caps, token limits, fraud windows: `infra/config/default.json` (override per stage in `infra/config/<stage>.json`), then redeploy.
- Per category and cause caps and required evidence: claim type packs (`seed/definitions/packs.ts`), then re-seed.
- Kill switch, no deploy needed: set SSM parameter `/claims/<stage>/autoApproveEnabled` to `false`. Every claim then routes to an adjuster.

## Test

```bash
npm run lint && npm run typecheck && npm test
```

## More

`docs/cost-estimate.md` (cost by service and Bedrock token math), `docs/value-model.md` (hours and dollars saved), `docs/DEMO-SCRIPT.md` (4 minute demo), `docs/STATUS.md` (what works and what is open).
