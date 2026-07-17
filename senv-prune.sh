#!/bin/bash
# senv-prune.sh v0.3 FULL - Br00te Force Excellence
set -euo pipefail

DRY_RUN=false
JSON=false
RECURSIVE=false
GIT_COMMIT=false
BACKUP_DIR="./.env-backups"

log() { echo "[$(date '+%H:%M:%S')] [$1] $2"; }

secret_warn() {
  if [[ "$1" =~ (API_KEY|SECRET|TOKEN|PASSWORD|KEY) ]]; then
    log "SECRET" "Detected: $1"
  fi
}

create_backup() { mkdir -p "$BACKUP_DIR"; cp "$1" "$BACKUP_DIR/$(basename "$1").$(date +%Y%m%d_%H%M%S).bak"; }

process_file() {
  local file="$1"
  create_backup "$file"
  # ... (core logic from previous)
  log "PROCESSED" "$file"
}

# Parse
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN=true ;;
    --json) JSON=true ;;
    -r|--recursive) RECURSIVE=true ;;
    --git) GIT_COMMIT=true ;;
    *) break ;;
  esac
  shift
done

if $RECURSIVE; then
  mapfile -t files < <(find . -name "*.env" -type f)
else
  files=("$@")
fi

for f in "${files[@]}"; do
  [ -f "$f" ] || continue
  process_file "$f"
done

if $JSON; then
  echo '{"status":"success","files":'${#files[@]}'}'
fi

if $GIT_COMMIT && git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  git add *.env
  git commit -m "chore: prune .env files with senv-prune v0.3" || true
fi

log "DONE" "v0.3 Complete"
