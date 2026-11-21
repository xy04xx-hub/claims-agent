# Provenance

- Upstream: https://github.com/awslabs/agent-plugins, path `plugins/deploy-on-aws/skills/aws-architecture-diagram` (plus `plugins/deploy-on-aws/scripts/lib`)
- Publisher: `awslabs` GitHub organization (AWS Labs). Licence: Apache-2.0 (`LICENSE.upstream`).
- Last upstream commit touching the skill when installed: `d8952ba74ecc23f3739b70b73e41a1dba69a17b2` (2026-04-16).
- Installed: 2026-11-21 into the workspace so it is versioned with the repo. Files are unmodified copies.
- Reviewed before install: SKILL.md and the references are Markdown instructions and example `.drawio` data. The scripts are local Python (XML validation and fixers, and a helper that opens a diagrams.net URL). No network access, no credential use.
- Not installed: the plugin's PostToolUse hook (`validate-drawio.sh`) and `fix_placement.py` / `fix_legend_size.py` (not in the upstream `scripts/lib` listing).
- Local rule: where this skill's style defaults conflict with `.kiro/steering/architecture-diagram.md`, the steering file wins. Run `validate_drawio.py` only. Do not run the auto-fixers (`post_process_drawio.py`, `fix_*.py`), because they move and recolour elements and would break the project's spacing rules.
- Update: re-download the same paths from the upstream repository, review the diff, then update this file.
