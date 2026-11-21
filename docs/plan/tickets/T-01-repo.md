# T-01: Repository, main branch, protection, PR template

| Field | Value |
|---|---|
| Owner | A |
| Milestone | M0 |
| Depends on | none |
| Judging items | OE1, OE5 |
| Estimate | 1 h |
| Status | Todo |
| Branch | `a/T-01-repo` |

## Why

Both people need to push, review and merge safely. Push to the remote failed earlier with a 403, so access comes first.

## Tasks

- [ ] Make sure both GitHub accounts have write access to the repository (the owner adds the other as collaborator).
- [ ] Create `main` from the current `kiro` branch and set it as the default branch (needs the repo owner `xy04xx-hub`; `main` itself is created by B's repo-structure PR).
- [ ] Protect `main`: require a pull request, one approving review, passing CI (added in T-04), and no force push.
- [ ] Add `.github/pull_request_template.md` with: ticket ID, what changed, verification evidence, judging items touched, checklist (tests, cdk-nag, docs, no secrets).
- [ ] Add `CODEOWNERS` that matches the ownership in `.kiro/steering/repository.md` section 2 (A's and B's GitHub usernames; shared paths list both).
- [x] `.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc` and the steering file `repository.md` (done in B's repo-structure PR).

## Acceptance criteria

- [ ] Both people can push a branch and open a PR.
- [ ] A direct push to `main` is rejected.
- [ ] The PR template appears on a new PR.

## Verification

- [ ] `git push origin <branch>` works from both IDEs.
- [ ] `git push origin main` from a local commit is rejected by protection.
- [ ] Open a test PR and see the template, then close it.

## Definition of Done

See `docs/plan/README.md` section 4: tests and CI green, cdk-nag clean, verified in your own dev stage with evidence in the PR, reviewed by the other person, docs updated, board updated.
