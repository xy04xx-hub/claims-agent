# Teammate onboarding (15 minutes)

Do these in your own workshop IDE and your own AWS account.

1. **Get the code**
   ```bash
   git clone https://github.com/xy04xx-hub/claims-agent.git
   cd claims-agent
   git checkout kiro        # becomes main in T-01
   ```
   If the push or clone is denied, ask the repo owner to add your GitHub account as a collaborator with write access.
2. **Read** `docs/plan/README.md` (or `docs/plan/kickoff.pdf`) sections 1 to 5, and `.kiro/steering/*.md`. Kiro loads the steering files for you, so it follows the same rules.
3. **Check your account** (part of T-03):
   ```bash
   aws sts get-caller-identity --query Account --output text
   ```
   Send the account number to your teammate so the board records both.
4. **Agree roles:** who is A (claims engine and agent) and who is B (platform, API and console). Edit section 1 and the Owner column of the board, or use the GitHub labels `owner:A` and `owner:B`.
5. **Start together:** T-01 (repo), T-02 (contracts), T-03 (accounts). Then B starts T-04 and A starts T-11.
6. **Daily:** a 15-minute sync. Update the board or the GitHub issues. Contract changes need both of you.
