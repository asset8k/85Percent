#!/usr/bin/env bash
set -euo pipefail

target="${1:-}"
if [[ -z "$target" ]]; then
  if [[ ! -t 0 ]]; then
    echo "Choose a target explicitly: pnpm data-sync:local:dev or pnpm data-sync:local:prod" >&2
    exit 2
  fi
  printf "Data Sync target [1] Development, [2] Production: "
  read -r choice
  case "$choice" in
    1|dev|development) target="dev" ;;
    2|prod|production) target="prod" ;;
    *) echo "No valid target selected." >&2; exit 2 ;;
  esac
fi

case "$target" in
  dev|prod) ;;
  *) echo "Target must be dev or prod." >&2; exit 2 ;;
esac

export DATA_IMPORT_DISPATCH_MODE=local
export DATA_IMPORT_DEFAULT_TARGET="$target"
export DATA_IMPORT_TARGETS="$target"

pnpm data-sync:adapter:start
if [[ "$target" == "prod" ]]; then
  echo "Starting local admin against PRODUCTION. Imports can change live clubs and players."
else
  echo "Starting local admin against Development."
fi
pnpm --filter @85percent/admin dev
