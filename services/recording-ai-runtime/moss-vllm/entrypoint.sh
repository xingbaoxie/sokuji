#!/bin/sh
set -eu

: "${SOKUJI_MOSS_MODEL_ID:?SOKUJI_MOSS_MODEL_ID is required}"
: "${SOKUJI_MOSS_MODEL_REVISION:?SOKUJI_MOSS_MODEL_REVISION is required}"

set -- vllm serve "$SOKUJI_MOSS_MODEL_ID" \
  --revision "$SOKUJI_MOSS_MODEL_REVISION" \
  --trust-remote-code \
  --host 0.0.0.0 \
  --port "${SOKUJI_MOSS_WORKER_PORT:-8000}" \
  --gpu-memory-utilization "${SOKUJI_MOSS_GPU_MEMORY_UTILIZATION:-0.82}" \
  --max-num-seqs 1

if [ -n "${SOKUJI_MOSS_MAX_MODEL_LEN:-}" ]; then
  set -- "$@" --max-model-len "$SOKUJI_MOSS_MAX_MODEL_LEN"
fi

exec "$@"
