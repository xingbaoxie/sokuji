#!/bin/sh
set -eu

: "${SOKUJI_FUNASR_MODEL_ID:=FunAudioLLM/Fun-ASR-Nano-2512}"
: "${SOKUJI_FUNASR_MODEL_HUB:=ms}"
: "${SOKUJI_FUNASR_VAD_MODEL_ID:=fsmn-vad}"
: "${SOKUJI_FUNASR_SPEAKER_MODEL_ID:=iic/speech_eres2netv2_sv_zh-cn_16k-common}"
: "${SOKUJI_FUNASR_VAD_MAX_SINGLE_SEGMENT_TIME_MS:=30000}"
: "${SOKUJI_FUNASR_GPU_MEMORY_UTILIZATION:=0.5}"
: "${SOKUJI_FUNASR_WORKER_PORT:=8000}"
# vLLM launches its engine in a child process. Pin the compiler explicitly so
# Triton's first CUDA helper build does not depend on PATH discovery there.
: "${CC:=/usr/bin/gcc}"
export CC

if [ "$SOKUJI_FUNASR_VAD_MAX_SINGLE_SEGMENT_TIME_MS" != "30000" ]; then
  echo "FunASR Meeting POC fixes FSMN-VAD max_single_segment_time at 30000 ms" >&2
  exit 64
fi

# This is the pinned upstream vLLM-only server. It directly constructs
# FunASRNanoVLLM; no generic AutoModel ASR fallback is started by this image.
exec python /opt/FunASR/examples/industrial_data_pretraining/fun_asr_nano/serve_vllm.py \
  --host 0.0.0.0 \
  --port "$SOKUJI_FUNASR_WORKER_PORT" \
  --model "$SOKUJI_FUNASR_MODEL_ID" \
  --hub "$SOKUJI_FUNASR_MODEL_HUB" \
  --device cuda:0 \
  --dtype bf16 \
  --gpu-memory-utilization "$SOKUJI_FUNASR_GPU_MEMORY_UTILIZATION" \
  --vad-model "$SOKUJI_FUNASR_VAD_MODEL_ID" \
  --spk-model "$SOKUJI_FUNASR_SPEAKER_MODEL_ID"
