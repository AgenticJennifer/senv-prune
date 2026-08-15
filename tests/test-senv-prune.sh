#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

cp "$ROOT/senv-prune.sh" "$TMPDIR/senv-prune.sh"
chmod +x "$TMPDIR/senv-prune.sh"

cat > "$TMPDIR/app.env" <<'ENV'
# demo env
API_KEY=old
DATABASE_URL=sqlite:///demo.db
API_KEY=new
ENV

(
  cd "$TMPDIR"
  ./senv-prune.sh --json app.env > output.log
)

test -d "$TMPDIR/.env-backups"
find "$TMPDIR/.env-backups" -name 'app.env.*.bak' | grep -q .
grep -q '"status":"success"' "$TMPDIR/output.log"
grep -q 'PROCESSED' "$TMPDIR/output.log"
test "$(grep -c '^API_KEY=' "$TMPDIR/app.env")" -eq 1
grep -q '^API_KEY=new$' "$TMPDIR/app.env"
grep -q '^DATABASE_URL=sqlite:///demo.db$' "$TMPDIR/app.env"

echo "senv-prune smoke test passed"
