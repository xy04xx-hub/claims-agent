#!/usr/bin/env bash
# Regenerate docs/architecture.drawio from the layout spec, validate it, and render docs/architecture.png.
# Usage: tools/diagram/build.sh [--jpeg]
set -euo pipefail
cd "$(dirname "$0")/../.."
PY=$(command -v python3.11 || command -v python3)
"$PY" tools/diagram/claims_architecture.py --write          # layout checker must report 0 errors
"$PY" .kiro/skills/aws-architecture-diagram/scripts/lib/validate_drawio.py docs/architecture.drawio
node tools/diagram/render.mjs docs/architecture.drawio "$@"   # writes docs/architecture.png (and .jpg with --jpeg)
