#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash -n "$ROOT/senv-prune.sh"
node --check "$ROOT/senv-prune.mjs"

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck "$ROOT/senv-prune.sh"
else
  printf '%s\n' "shellcheck not installed; bash syntax check passed"
fi
