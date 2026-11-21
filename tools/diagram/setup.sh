#!/usr/bin/env bash
# One-time setup for diagram rendering: installs puppeteer (headless Chrome) and, if the machine lacks
# Chrome's shared libraries and has no root, unpacks them locally into tools/diagram/.libs (Amazon Linux).
set -euo pipefail
cd "$(dirname "$0")"
npm install --no-audit --no-fund
PY=$(command -v python3.11 || command -v python3); "$PY" -m pip install --user --quiet "defusedxml>=0.7.1"
SHELL_BIN=$(ls -d "$HOME"/.cache/puppeteer/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | head -1 || true)
[ -n "$SHELL_BIN" ] || { echo "chrome-headless-shell not found, run: npx puppeteer browsers install chrome-headless-shell"; exit 1; }
if ldd "$SHELL_BIN" | grep -q "not found"; then
  if command -v dnf >/dev/null; then
    echo "Chrome libraries missing, unpacking them locally (no root needed)"
    tmp=$(mktemp -d); mkdir -p .libs
    dnf download --resolve --alldeps --destdir "$tmp" atk at-spi2-atk at-spi2-core libXcomposite libXdamage libXfixes mesa-libgbm libxkbcommon libXrandr alsa-lib pango cairo nss >/dev/null
    for f in "$tmp"/*.rpm; do (cd .libs && rpm2cpio "$f" | cpio -idmu --quiet 2>/dev/null; chmod -R u+w .); done
    rm -rf "$tmp"
  else
    echo "Install Chrome's shared libraries with your package manager (see https://pptr.dev/troubleshooting)"; exit 1
  fi
fi
echo "setup done"
