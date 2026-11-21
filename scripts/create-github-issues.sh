#!/usr/bin/env bash
# Create GitHub labels, milestones and one issue per ticket from docs/plan/tickets/*.md.
# Needs the GitHub CLI, logged in with write access to the repo:  gh auth login
# Usage: scripts/create-github-issues.sh [owner/repo]     (defaults to the current repo)
# Safe to re-run: existing labels and milestones are kept, issues with the same title are skipped.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
echo "Repository: $REPO"

label() { gh label create "$1" --repo "$REPO" --color "$2" --description "$3" 2>/dev/null || true; }
label "owner:A"   "1D76DB" "Claims engine and agent"
label "owner:B"   "0E8A16" "Platform, API and console"
label "owner:A+B" "5319E7" "Shared ticket"
for m in M0 M1 M2 M3 M4 M5; do label "milestone:$m" "FBCA04" "Plan milestone $m"; done

milestone() {
  gh api "repos/$REPO/milestones" --paginate -q '.[].title' | grep -qx "$1" \
    || gh api "repos/$REPO/milestones" -f title="$1" -f description="$2" >/dev/null
}
milestone "M0 Setup and contracts" "Repo, CI, accounts ready, contracts agreed"
milestone "M1 Walking skeleton"    "Submit to final status with a stub agent in both dev stages"
milestone "M2 Decisions without AI" "Coverage, caps, fraud signals, audit, kill switch"
milestone "M3 Agent"               "AgentCore, Gateway, ticket, Bedrock; latency target met"
milestone "M4 Product complete"    "Customer, adjuster, impact panel, dashboard"
milestone "M5 Demo ready"          "Hardening, docs, cost, rehearsals, demo stage"

existing=$(gh issue list --repo "$REPO" --state all --limit 500 --json title -q '.[].title')

for f in docs/plan/tickets/T-*.md; do
  title=$(head -1 "$f" | sed 's/^# //')
  if grep -qxF "$title" <<<"$existing"; then echo "skip  $title"; continue; fi
  owner=$(grep -m1 '^| Owner |' "$f" | sed 's/^| Owner | \(.*\) |$/\1/')
  ms=$(grep -m1 '^| Milestone |' "$f" | sed 's/^| Milestone | \([^ ,|]*\).*/\1/')
  case "$owner" in
    "A + B"*) ol="owner:A+B" ;;
    A*)       ol="owner:A" ;;
    *)        ol="owner:B" ;;
  esac
  msname=$(gh api "repos/$REPO/milestones" --paginate -q ".[] | select(.title|startswith(\"$ms \")) | .title")
  gh issue create --repo "$REPO" --title "$title" --body-file "$f" \
    --label "$ol" --label "milestone:$ms" --milestone "$msname" >/dev/null
  echo "added $title"
done
echo "Done. Optional: create a Project board in GitHub and add these issues (Projects > New > Board)."
