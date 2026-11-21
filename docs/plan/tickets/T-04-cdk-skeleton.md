# T-04: CDK app skeleton, repo layout, CI, cdk-nag

| Field | Value |
|---|---|
| Owner | B |
| Milestone | M0 |
| Depends on | T-01 |
| Judging items | OE1, SEC3, COST3 |
| Estimate | 3 h |
| Status | Todo |
| Branch | `b/T-04-cdk-skeleton` |

## Why

One CDK app that both people extend without stepping on each other, with security checks from the first commit.

## Tasks

- [ ] npm workspaces layout exactly as `.kiro/steering/repository.md` section 2, including the empty owner folders with a `README.md` each.
- [ ] `infra/bin/app.ts`: reads `-c stage=<name>` (required), creates stacks `ClaimsAgent-<stage>-Foundation`, `-Auth`, `-Api`, `-Processing`, `-Agent`, `-Web`, `-Ops` in us-east-1. Pass resources between stacks as typed props, not string imports.
- [ ] Empty stack classes with an owner comment: B owns Foundation, Auth, Api, Web, Ops; A owns Processing, Agent.
- [ ] Shared construct `ClaimsFunction` (wraps `NodejsFunction`): Node.js 22, ARM64, explicit timeout and memory, its own role, Powertools layer or bundle, log retention 14 days, environment from props, tracing on.
- [ ] Apply tags `project=claims-agent`, `stage=<name>` to everything. Removal policy: `DESTROY` for dev stages, `RETAIN` for data in `demo` (configurable).
- [ ] Add cdk-nag `AwsSolutionsChecks` to the app. Fail synth on errors.
- [ ] Config file `infra/config/<stage>.json` (falls back to `default.json`) for thresholds, model ID and caps. No secrets in it.
- [ ] GitHub Actions workflow on PR: `npm ci`, lint (ESLint), typecheck, `vitest run`, `npx cdk synth -c stage=ci`, gitleaks secret scan.
- [ ] Root scripts: `npm run deploy -- <stage>`, `npm run destroy -- <stage>`, `npm run seed -- --stage <stage>`, `npm run outputs -- <stage>` (writes stack outputs to `frontend/.env.<stage>`).

## Acceptance criteria

- [ ] `npx cdk synth -c stage=dev-a` produces 7 stacks with no cdk-nag errors.
- [ ] CI runs on a PR and is required by branch protection.
- [ ] `npm run deploy -- dev-b` deploys the empty stacks into B's account.

## Verification

- [ ] Open a PR and see all CI jobs pass.
- [ ] `npx cdk list -c stage=dev-b` lists the 7 stacks.
- [ ] Deploy, then `npm run destroy -- dev-b` removes them cleanly.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
