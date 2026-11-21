# Repository Structure and Git Workflow

Both team members and Kiro follow this file. It decides where code goes, who owns it, and how changes reach `main`, so the two branches merge without surprises. Changing this file needs a PR approved by both owners.

## 1. Owners and branches

| Owner | Person | Personal branch | Ticket branch prefix | Area |
|---|---|---|---|---|
| **A** | teammate | `kiro-a` | `a/` | Claims engine and agent |
| **B** | muzair110 | `owner-b` | `b/` | Platform, API and console |

- **`main`** is the only integration branch, the default branch and the only source for the `demo` stage. Protected: PR required, 1 approval from the other owner, CI green, no force push, no direct push.
- **Work on ticket branches cut from `main`**, named with your owner prefix: `a/T-11-domain`, `b/T-04-cdk-skeleton`. One ticket per branch. Delete the branch after it merges. (The prefix cannot be the personal branch name: Git does not allow a branch `owner-b` and a branch `owner-b/...` at the same time.)
- `kiro-a` and `owner-b` stay as personal scratch branches. Never open a PR from them, never merge one personal branch into the other, and never base ticket work on them. Reason: `main` is squash-merged, so a long-lived branch drifts and its old commits conflict with their own squashed copies.
- `kiro` is the old shared branch. It is frozen after `main` is created from it.

## 2. Directory layout

```
claims-agent/
├── .github/                    B  CI workflow, PR template, CODEOWNERS (changes need both)
├── .kiro/
│   ├── steering/                  both, changes need both
│   ├── specs/                     one folder per ticket, owned by the ticket owner (section 7)
│   └── skills/                    both (vendored, see SOURCE.md)
├── contracts/                  both  JSON Schemas + examples, VERSION; changes need both
│   ├── api/                       request and response per route
│   ├── tools/                     MCP tool input and output
│   ├── job-message.json  proposal.json  decision.json  audit-record.json
│   ├── data-model.md  job-ticket.md  VERSION
├── infra/                         CDK app (TypeScript)
│   ├── bin/app.ts              B  creates every stack, one block per stack (T-04); A edits only the Processing and Agent blocks
│   ├── lib/stacks/
│   │   ├── foundation-stack.ts  auth-stack.ts  api-stack.ts  web-stack.ts  ops-stack.ts   B
│   │   └── processing-stack.ts  agent-stack.ts                                            A
│   ├── lib/constructs/
│   │   ├── claims-function.ts  B  shared Lambda construct, changes need both
│   │   ├── platform/           B
│   │   └── engine/             A
│   ├── config/
│   │   ├── default.json        both  thresholds, model ID, caps (no secrets)
│   │   ├── demo.json           both
│   │   ├── dev-a.json          A
│   │   └── dev-b.json          B
│   ├── test/                      stack assertion tests, owner of the stack
│   └── cdk.json  package.json  tsconfig.json   B
├── backend/                       Lambda code (TypeScript, Node.js 22, ARM64)
│   ├── shared/                 both  logger, metrics, errors, config, AWS clients; changes need both
│   ├── domain/                 A  pure decision rules, packs, types (no AWS calls)
│   ├── api/                    B  api-customer, api-adjuster handlers, validation middleware
│   ├── auth/                   B  pre token generation trigger
│   ├── processing/             A  evidence-processor, worker, decision
│   └── tools/                  A  lookup-policy, check-fraud-signals, verify-evidence, interceptor
├── agent/                      A  Investigator agent for AgentCore Runtime (language per ADR 0001)
├── frontend/                   B  React + Vite console
├── seed/                       A  synthetic seed data and evidence files (no real personal data)
├── scripts/                       one owner per script, named in its header comment
│   ├── seed.ts  smoke.ts  test-adversarial.ts        A
│   └── seed-users.ts  outputs.ts  create-github-issues.sh   B
├── tests/                         cross-component tests
│   ├── e2e/                    both  smoke scenarios A to N
│   └── adversarial/            A
├── tools/                      B  diagram and kickoff-pack builders (not deployed)
├── docs/
│   ├── adr/                    both  0001-agentcore-in-cdk.md, ...
│   ├── plan/                   both  plan and tickets
│   └── architecture.*  cost-estimate.md  value-model.md  product-architecture-deep-dive.md   both
├── package.json                B  npm workspaces root, shared scripts; changes need both
├── package-lock.json              generated (see section 4)
├── .gitignore  .gitattributes  .editorconfig  .nvmrc   B
└── README.md                   B  (T-26)
```

npm workspaces: `infra`, `backend/*`, `agent` (if TypeScript), `frontend`, `contracts`, `tools/diagram`. Each workspace has its own `package.json`. Unit tests sit next to the code as `*.test.ts`.

**Placement rules**

- New Lambda code goes in the owner's `backend/<area>/<function-name>/` folder, with `index.ts` as the handler. Its CDK wiring goes in the owner's stack or construct folder.
- Code that both sides import goes in `backend/shared` or `contracts`, never copied.
- Anything that crosses the A/B boundary (API ↔ queue ↔ worker ↔ decision ↔ tools) goes through `contracts/`. Change the contract first, in its own PR, then the code.
- Cross-stack wiring uses typed stack props in `bin/app.ts`. No `Fn.importValue` strings, no hard-coded ARNs or names.

## 3. Naming

| Thing | Convention | Example |
|---|---|---|
| Stage | `dev-a`, `dev-b`, `demo` | `npm run deploy -- dev-b` |
| Stack | `ClaimsAgent-<stage>-<Name>` | `ClaimsAgent-dev-b-Api` |
| Lambda folder and construct ID | kebab-case, verb or role | `check-fraud-signals`, `api-customer` |
| Physical resource names | Let CDK generate them. Only SSM parameters have fixed paths | `/claims/<stage>/autoApproveEnabled` |
| Env vars for Lambdas | UPPER_SNAKE | `CLAIMS_TABLE`, `EVIDENCE_BUCKET` |
| TypeScript files | kebab-case | `decision-rules.ts` |
| Ticket branch | `a/T-xx-short-name` or `b/T-xx-short-name` | `b/T-05-foundation` |
| Commit | Conventional Commits with ticket ID | `feat(T-11): add coverage checks` |
| PR title | `T-xx: <ticket title>` | `T-05: Foundation stack` |

Commit types: `feat`, `fix`, `test`, `docs`, `infra`, `refactor`, `chore`.

## 4. Rules that prevent merge conflicts

1. **Stay in your area.** Edit only folders you own. To change something owned by the other person, open a PR and request their review, or ask them.
2. **Shared files** (marked "changes need both" above) change only in small PRs that do nothing else.
3. **`bin/app.ts`:** B creates all seven stack blocks in T-04. After that each owner edits only their own blocks.
4. **Dependencies:** add them only to your own workspace (`npm install <pkg> -w backend/domain`). Never hand-edit `package-lock.json`. On a lockfile conflict: take `main`'s version, run `npm install`, commit the result.
5. **Generated files are never merged by hand:** `docs/architecture.drawio`, `docs/architecture.png`, `docs/plan/kickoff.pdf`, `package-lock.json`. On conflict, take either side, regenerate (`tools/diagram/build.sh`, `node tools/plan/build-kickoff.mjs`, `npm install`) and commit.
6. **The diagram changes only through `tools/diagram/claims_architecture.py`.** If both of you need diagram changes, the second PR rebuilds after rebasing.
7. **Config:** personal settings go in `infra/config/dev-a.json` or `dev-b.json`, never in `default.json` unless both agree.
8. **No secrets, account IDs or personal data in the repo.** Account IDs live in your shell environment (`CDK_DEFAULT_ACCOUNT` comes from your workshop credentials).
9. **Keep PRs small** (under about 400 changed lines, generated files excluded) and merge at least once a day, so branches never drift far.

## 5. Daily commands

Start a ticket:

```bash
git fetch origin
git switch -c b/T-05-foundation origin/main           # A uses a/T-xx-...
```

Stay current while working (rebase, never merge `main` into a ticket branch):

```bash
git fetch origin
git rebase origin/main
git push --force-with-lease                           # only on your own ticket branch
```

Finish:

```bash
npm run lint && npm run typecheck && npm test && npx cdk synth -c stage=ci
git push -u origin HEAD
gh pr create --base main --title "T-05: Foundation stack" --fill --assignee @me
```

The other owner reviews, then squash-merges and deletes the branch. Both owners then run `git fetch origin` and start the next ticket from `origin/main`.

Deploy to `demo` only from an up-to-date `main` (see T-29).

## 6. Kiro

- Before creating or moving a file, check section 2 for the right folder and owner. If the file belongs to the other owner, say so and suggest a PR or a contract change instead of editing it.
- Use ticket branches as in section 5. Do not commit to `main`, `kiro`, `kiro-a` or `owner-b` directly.
- Follow the commit and PR naming in section 3.
- Never resolve conflicts in generated files by hand (section 4, rule 5).

## 7. Specs

Kiro specs (`requirements.md`, `design.md`, `tasks.md`) turn a ticket into reviewed requirements, a design and executable tasks.

- **One spec per ticket**, created on that ticket's branch and merged in the same PR as the code. Folder name: `.kiro/specs/<a|b>-t<xx>-<slug>/`, for example `.kiro/specs/b-t04-cdk-skeleton/`. The owner prefix keeps A's and B's specs from colliding.
- **Seed the spec from the ticket file**, which is the source of truth for scope: start the spec with `#docs/plan/tickets/T-xx-....md` in the prompt. The spec may add detail but must not add scope. If it needs more scope, update the ticket first.
- **Workflow:** Requirements-First for tickets with security or behaviour rules (T-06, T-08, T-09, T-10, T-14, T-18, T-19, T-22, T-23). Quick Spec is fine for small, well-understood tickets (T-04, T-05, T-07, T-21, T-24, T-25). No spec for docs-only tickets (T-26, T-28).
- **Requirements** use EARS (`WHEN ... THE SYSTEM SHALL ...`) and must include every acceptance criterion of the ticket. **Design** follows `architecture.md` and `contracts/`. **Tasks** end with the ticket's verification steps.
- Each spec task maps to one commit (`feat(T-04): <task>`), so the PR history reads like the task list.
- A spec is done when every required task is checked, the ticket's Definition of Done is met, and the PR is merged. Do not edit another owner's spec; comment on their PR instead.
