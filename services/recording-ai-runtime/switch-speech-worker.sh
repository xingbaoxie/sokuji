#!/bin/sh
# POC operator action: never stops the active GPU worker automatically.
set -eu

case "${1:-}" in
  moss) target=moss-worker; other=funasr-worker; profile=moss ;;
  funasr) target=funasr-worker; other=moss-worker; profile=funasr ;;
  *) echo "Usage: $0 moss|funasr" >&2; exit 64 ;;
esac

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$root"

if docker compose ps --status running --services | grep -Fx "$other" >/dev/null; then
  echo "Refusing to start $target: $other is running. Stop it only after its active task has reached a terminal state." >&2
  exit 1
fi

docker compose --profile "$profile" up -d "$target"
echo "$target started. control-api remains running; no model worker was stopped automatically."
