# MVP Delivery Plan (2 people, 2 AWS accounts)

This plan turns `architecture.md` into tickets that two people can work on in parallel and verify on their own. The steering files win if anything here conflicts with them.

- **Board:** section 7 (move tickets by editing the Status column).
- **Tickets:** `docs/plan/tickets/T-xx-*.md`, one file each, with tasks, acceptance criteria and verification steps.
- **Judging codes used in tickets:** `OE1-5` operational excellence, `SEC1-5` security, `COST1-5` cost, `BIZ-C` complete, `BIZ-V` value, `BIZ-P` presentation. They match `judging-criteria.md`.

## 1. Roles

**A** is the teammate, working from personal branch `kiro-a`. **B** is muzair110, working from `owner-b`. Folder ownership, branches and merge rules are in `.kiro/steering/repository.md`.

| | **A: Claims engine and agent** | **B: Platform, API and console** |
|---|---|---|
| Owns | Decision logic, seed data, evidence processing, Worker, Decision Lambda, tool Lambdas, AgentCore (Runtime, Gateway, Interceptor, job ticket), Bedrock prompts and Guardrails, token and cost measurement | CDK skeleton and CI, Foundation (KMS, DynamoDB, S3, SSM), Cognito, HTTP API and API Lambdas, SQS and DLQ, web hosting, React console (customer, adjuster, impact panel), dashboard and alarms, README |
| CDK stacks | `Processing`, `Agent` | `Foundation`, `Auth`, `Api`, `Web`, `Ops` |
| Code folders | `backend/domain`, `backend/processing`, `backend/tools`, `agent/` | `infra/` (shared skeleton), `backend/api`, `frontend/` |
| Judging lead | SEC3, SEC5, COST1, COST2, COST4, OE3, OE4 | SEC1, SEC2, SEC4, OE1, OE2, OE5, COST3 |
| Shared | Contracts (T-02), demo account deploy (T-29), value and demo (T-28), security review (T-30) | same |

Why this split: each person owns a vertical slice with few touch points. The touch points are written down as contracts in T-02 before coding starts. Until the real component exists, each side codes against a stub.

## 2. Accounts and environments

The two workshop accounts are separate, so each person deploys a full copy of the app into their own account. Nothing is shared between the accounts.

| Environment | Account | Who deploys | From | Purpose |
|---|---|---|---|---|
| `dev-a` | A's account | A | A's feature branches | A's development and verification |
| `dev-b` | B's account | B | B's feature branches | B's development and verification |
| `demo` | **One** chosen account (confirm in T-03; default: B's account `579813007466`) | Either, from `main` only | `main` | Integration checkpoints and the judged demo |

Rules:

- One CDK app, one stage name per environment: `npx cdk deploy --all -c stage=dev-a`. Stack names are `ClaimsAgent-<stage>-<Stack>`.
- Each account is bootstrapped once (`cdk bootstrap`) and must have Bedrock access for Claude Haiku 5.5 and AgentCore in us-east-1 (T-03).
- Seed data is synthetic and loaded by script (`npm run seed -- --stage <stage>`), so every environment can be rebuilt from nothing. Workshop accounts are deleted after the event, so nothing may exist only in an account.
- No credentials are shared between people or accounts. Each person deploys with their own workshop role.

## 3. Engineering practice

- **Repository:** trunk-based on `main` with one short ticket branch per ticket, cut from `main` and named `a/T-xx-short-name` (A) or `b/T-xx-short-name` (B). Personal branches `kiro-a` and `owner-b` are scratch only. Full rules, folder ownership and daily commands: `.kiro/steering/repository.md`.
- **Pull requests:** every change goes through a PR reviewed by the other person. Use the PR template from T-01 (ticket ID, verification evidence, judging items touched). Squash merge. Keep PRs small, ideally under about 400 changed lines.
- **CI (GitHub Actions, T-04):** install, lint, typecheck, unit tests, `cdk synth` for a dummy stage, cdk-nag, and a secret scan. It runs on every PR. CI does not deploy, because workshop accounts have no CI credentials.
- **Languages:** TypeScript for CDK and all Lambdas (Node.js 22, ARM64, bundled with esbuild through `NodejsFunction`). The agent's language is decided in the T-16 spike: Python if the AgentCore tooling for it is clearly simpler, otherwise TypeScript. JSON Schemas in `contracts/` are the source of truth that both languages validate against.
- **Testing:** unit tests (Vitest) for all decision, tool and validation code. Every ticket also has deploy-and-verify steps. The required tests from the steering files are their own acceptance criteria (T-11, T-14, T-18).
- **Security by default:** cdk-nag (AwsSolutions) must be clean or have each suppression justified in code. There are no `*` resources unless AWS requires one, with a comment. No secrets go in code or config.
- **Observability by default:** every Lambda uses Powertools for AWS Lambda (TypeScript) for structured logs with `claimId` and request ID, and for EMF metrics.
- **Docs as you go:** a ticket that changes architecture also updates `architecture.md` and rebuilds the diagram (`tools/diagram/build.sh`).

## 4. Definition of Done (every ticket)

1. Acceptance criteria met and the ticket's verification steps run in your own dev stage, with evidence in the PR (command output, screenshot or log link).
2. Unit tests added or updated, and CI green.
3. cdk-nag clean (or each suppression justified).
4. Reviewed and approved by the other person, then merged to `main`.
5. Docs updated if behaviour, cost or architecture changed.
6. Board status set to Done.

## 5. Milestones and integration checkpoints

| Milestone | Goal | Exit check (both run it) |
|---|---|---|
| **M0 Setup and contracts** | Repo, CI, accounts ready, contracts agreed | T-01 to T-04 done. `cdk synth` works in CI |
| **M1 Walking skeleton** | Sign in, upload, submit, queue, Worker (stub agent), Decision, status shown in a minimal page, deployed in both dev stages | A claim submitted in `dev-a` and `dev-b` reaches a final status in under 10 s |
| **M2 Real decisions without AI** | Coverage, caps, fraud signals, duplicate photo, audit record, kill switch, all deterministic | Seeded demo cases give the expected outcomes through the stub agent (which returns the seeded fields) |
| **M3 Agent** | AgentCore Runtime, Gateway, Interceptor, job ticket, Bedrock with caching and Guardrails | Same cases pass with the real agent. Happy path p50 about 4 s, p95 at most 6 s |
| **M4 Product complete** | Customer flow, adjuster console, impact panel, dashboard and alarms | Full demo script runs end to end in a dev stage |
| **M5 Demo ready** | Hardening, docs, cost, value slide, rehearsals, deploy to `demo` from `main` | T-29 smoke test passes in `demo`. Two timed rehearsals under 4 minutes |

Integration happens at every milestone, not only at the end. At M1, M3 and M5, deploy `main` to the `demo` stage and run the smoke test (T-29).

## 6. Dependency map

```
T-01 repo -> T-04 CDK skeleton + CI --------------------------+
T-02 contracts -----------------------------------------------+--> everything else
T-03 accounts (both) -----------------------------------------+

B: T-05 foundation -> T-06 auth -> T-08 API skeleton -> T-09 submit + queue -> T-10 adjuster API
                   \-> T-07 web hosting -> T-21 console -> T-22 customer UI -> T-23 adjuster UI -> T-24 impact
                                                    T-25 dashboard and alarms (after T-14, T-19)
A: T-11 domain rules -> T-12 seed -> T-13 evidence processor
                     \-> T-14 decision lambda -> T-15 worker (stub)   [M1 with B's T-09]
   T-16 AgentCore spike -> T-17 tools -> T-18 gateway + interceptor + ticket -> T-19 agent -> T-20 adversarial tests
Both: T-26 README (B), T-27 cost check (A), T-28 value and demo, T-29 demo deploy and smoke, T-30 security review
```

## 7. Board

Status values: `Todo`, `In progress`, `In review`, `Done`, `Blocked`.

| ID | Title | Owner | Milestone | Depends on | Est. h | Status |
|---|---|---|---|---|---|---|
| T-01 | Repository, `main` branch, protection, PR template | A | M0 | none | 1 | Todo |
| T-02 | Contracts: API, data, job, tools, proposal, decision, ticket | A + B | M0 | none | 3 | Todo |
| T-03 | Account readiness in both accounts, choose demo account | A + B | M0 | none | 1 | Todo |
| T-04 | CDK app skeleton, repo layout, CI, cdk-nag | B | M0 | T-01 | 3 | Todo |
| T-05 | Foundation stack: KMS, DynamoDB, S3 evidence, SSM | B | M1 | T-02, T-04 | 3 | Todo |
| T-06 | Auth stack: Cognito, groups, tenant claim in access token | B | M1 | T-05 | 3 | Todo |
| T-07 | Web stack: CloudFront, OAC, private bucket | B | M1 | T-04 | 2 | Todo |
| T-08 | API stack: HTTP API, JWT authorizer, API Lambdas, validation | B | M1 | T-06 | 3 | Todo |
| T-09 | Evidence upload, claim submit, SQS + DLQ, status routes | B | M1 | T-08 | 4 | Todo |
| T-10 | Adjuster API: queue, evidence links, resolution | B | M2 | T-09 | 3 | Todo |
| T-11 | Domain package: packs, coverage and decision rules, tests | A | M1 | T-02 | 4 | Todo |
| T-12 | Synthetic seed data and seed script | A | M1 | T-05, T-11 | 3 | Todo |
| T-13 | Evidence Processor: hashes, EXIF, normalized image | A | M2 | T-05 | 4 | Todo |
| T-14 | Decision Lambda: approve/route, kill switch, audit, metrics | A | M1 | T-11 | 4 | Todo |
| T-15 | Worker Lambda with stub agent | A | M1 | T-09, T-14 | 3 | Todo |
| T-16 | Spike: AgentCore in CDK, agent language (timebox 3 h) | A | M2 | T-04 | 3 | Todo |
| T-17 | Read-only tool Lambdas | A | M3 | T-11, T-12 | 4 | Todo |
| T-18 | Gateway (IAM), Interceptor, KMS job ticket | A | M3 | T-16, T-17 | 5 | Todo |
| T-19 | Investigator agent: Bedrock, caching, Guardrails, proposal | A | M3 | T-18 | 6 | Todo |
| T-20 | Adversarial and latency test set | A | M4 | T-19 | 3 | Todo |
| T-21 | Console skeleton: auth, routing by role, API client | B | M1 | T-06, T-07 | 3 | Todo |
| T-22 | Customer claim flow UI | B | M2 | T-09, T-21 | 5 | Todo |
| T-23 | Adjuster console UI | B | M3 | T-10, T-21 | 4 | Todo |
| T-24 | Impact panel (API + UI) | B | M4 | T-14, T-23 | 2 | Todo |
| T-25 | Dashboard, alarms, AgentCore observability | B | M4 | T-14, T-19 | 3 | Todo |
| T-26 | README: run, deploy, seed, change thresholds | B | M5 | T-25 | 2 | Todo |
| T-27 | Cost check from measured usage | A | M5 | T-19 | 2 | Todo |
| T-28 | Value slide, demo script, rehearsals | A + B | M5 | T-24, T-27 | 4 | Todo |
| T-29 | Demo stage deploy and smoke test script | A + B | M1, M3, M5 | T-15 | 3 | Todo |
| T-30 | Security and Well-Architected review against judging items | A + B | M5 | T-19, T-25 | 3 | Todo |

Load: A about 56 h, B about 54 h (shared tickets counted for both).

## 8. Judging coverage

Each item must be **shown** in the demo. The ticket that produces the evidence is listed.

| Item | Evidence | Ticket |
|---|---|---|
| OE1 Built from code | `cdk deploy --all` and the CDK app in the repo | T-04, T-29 |
| OE2 Logs and metrics | CloudWatch dashboard, structured logs, AgentCore traces | T-25 |
| OE3 Error handling | Retries with backoff, DLQ route-only path shown live | T-14, T-15, T-19, T-29 |
| OE4 Fast responses | Happy path p50 about 4 s on stage | T-19, T-20, T-29 |
| OE5 Docs | README | T-26 |
| SEC1 Authentication | Cognito sign-in for both roles | T-06, T-21 |
| SEC2 Authorization | Customer sees own claims only, adjuster sees queue | T-08, T-09, T-10 |
| SEC3 Least privilege | One role per Lambda, IAM Gateway auth, signed ticket | T-18, T-30 |
| SEC4 Network | CloudFront HTTPS, private S3 with OAC, Block Public Access, no public data stores | T-05, T-07 |
| SEC5 App security | Schema validation, upload limits, Guardrails, prompt-injection tests, no secrets | T-08, T-09, T-19, T-20 |
| COST1 Monthly estimate | `docs/cost-estimate.md` with token math | T-27 |
| COST2 Detailed pricing | Per-service table with measured usage | T-27 |
| COST3 Serverless | Lambda, HTTP API, DynamoDB on-demand, SQS | T-04 to T-09 |
| COST4 Bedrock controls | Haiku 5.5, caching, `maxTokens`, cache hits shown in traces | T-19, T-27 |
| COST5 Production savings | `docs/value-model.md`, impact panel | T-24, T-28 |
| BIZ-C Complete | Customer chat, decision, adjuster console, audit, all on seeded data | M4 exit |
| BIZ-V Value | Dollars and hours with sources | T-28 |
| BIZ-P Presentation | Timed script with problem, demo, result, next steps | T-28 |

## 9. Risks

| Risk | Mitigation | Ticket |
|---|---|---|
| AgentCore features (IAM inbound, interceptor with headers) missing in CDK L2 | Spike first, fall back to L1 (`Cfn*`) resources | T-16 |
| Agent latency over 6 s | Measure per stage from M3. Fallback: fixed pipeline over the same Lambdas | T-19, T-20 |
| Two accounts drift apart | Everything from CDK and the seed script. Integration deploys to `demo` at M1, M3 and M5 | T-29 |
| Bedrock or AgentCore quotas in a workshop account | Check in T-03. Worker concurrency capped | T-03, T-15 |
| Merge conflicts in shared CDK files | Each person owns separate stacks and construct files. `bin/app.ts` changes are small and reviewed | T-04 |
| Tenant claim missing from Cognito access tokens | Pre token generation trigger (V2) adds it. Needs the Essentials plan | T-06 |
| Workshop accounts deleted after the event | Everything lives in git, and `demo` can be rebuilt with one command plus the seed script | T-26 |

## 10. Working rhythm

- **Daily:** a 15-minute sync. Update the board, raise blockers, and agree on any contract change (a contract change needs both people and a PR to `contracts/`).
- **Before M1:** B deploys stubs (API returns fixed data) so A can test against real infrastructure early, and A provides the stub Worker so B's UI can show final statuses.
- **Before each demo rehearsal:** run the T-29 smoke test and check latency on the dashboard.
