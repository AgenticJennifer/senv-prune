#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

cp "$ROOT/senv-prune.sh" "$TMPDIR/senv-prune.sh"
chmod +x "$TMPDIR/senv-prune.sh"

cat > "$TMPDIR/app.env" <<'ENV'
API_KEY=example
API_KEY=example
DATABASE_URL=sqlite:///demo.db
ENV

(
  cd "$TMPDIR"
  ./senv-prune.sh app.env --json > output.log
)

test -d "$TMPDIR/.env-backups"
find "$TMPDIR/.env-backups" -name 'app.env.*.bak' | grep -q .
grep -q '"status":"success"' "$TMPDIR/output.log"
grep -q 'PROCESSED' "$TMPDIR/output.log"

echo "senv-prune smoke test passed"
