#!/bin/bash
# senv-prune.sh v0.3
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

create_backup() {
  mkdir -p "$BACKUP_DIR"
  cp "$1" "$BACKUP_DIR/$(basename "$1").$(date +%Y%m%d_%H%M%S).bak"
}

prune_duplicates() {
  local file="$1"
  local tmp
  tmp="$(mktemp)"

  awk '
    /^[[:space:]]*($|#)/ { passthrough[NR] = $0; next }
    /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=/ {
      key = $0
      sub(/^[[:space:]]*/, "", key)
      sub(/=.*/, "", key)
      order[NR] = key
      value[key] = $0
      last[key] = NR
      next
    }
    { passthrough[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) {
        if (i in passthrough) {
          print passthrough[i]
        } else if ((i in order) && last[order[i]] == i) {
          print value[order[i]]
        }
      }
    }
  ' "$file" > "$tmp"

  if ! $DRY_RUN; then
    mv "$tmp" "$file"
  else
    rm -f "$tmp"
  fi
}

process_file() {
  local file="$1"
  create_backup "$file"
  prune_duplicates "$file"

  while IFS='=' read -r key _; do
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] && secret_warn "$key"
  done < "$file"

  log "PROCESSED" "$file"
}

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
