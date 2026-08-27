#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

cat > "$TMPDIR/app.env" <<'ENV'
# demo env
API_KEY=old
DATABASE_URL=sqlite:///demo.db
API_KEY=new
ENV

"$ROOT/senv-prune.sh" --dry-run --json "$TMPDIR/app.env" > "$TMPDIR/dry-run.json"
test ! -d "$TMPDIR/.env-backups"
test "$(grep -c '^API_KEY=' "$TMPDIR/app.env")" -eq 2
grep -q '"filesChanged": 1' "$TMPDIR/dry-run.json"

"$ROOT/senv-prune.sh" --json "$TMPDIR/app.env" > "$TMPDIR/write.json"
test -d "$TMPDIR/.env-backups"
find "$TMPDIR/.env-backups" -name 'app.env.*.bak' | grep -q .
test "$(grep -c '^API_KEY=' "$TMPDIR/app.env")" -eq 1
grep -q '^API_KEY=new$' "$TMPDIR/app.env"
grep -q '^DATABASE_URL=sqlite:///demo.db$' "$TMPDIR/app.env"

echo "senv-prune integration test passed"
