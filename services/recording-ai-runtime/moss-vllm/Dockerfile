FROM nvidia/cuda:13.0.0-runtime-ubuntu24.04

ARG VLLM_EXTRA_INDEX=https://wheels.vllm.ai/68b4a1d582818e67adc903bf1b8fc5a5447da2fa/cu130
ENV DEBIAN_FRONTEND=noninteractive \
    HF_HOME=/models/huggingface \
    TRANSFORMERS_CACHE=/models/huggingface \
    PATH=/opt/vllm/bin:$PATH \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    # Triton compiles small CUDA helper modules at first vLLM start-up.
    # `vllm[audio]` uses soundfile for uploaded MP3/WAV decoding; libsndfile is
    # the system library behind that Python package.
    && apt-get install -y --no-install-recommends build-essential ca-certificates ffmpeg libsndfile1 python3 python3-dev python3-pip python3-venv \
    && python3 -m pip install --break-system-packages --no-cache-dir uv \
    && uv venv --python /usr/bin/python3 /opt/vllm \
    && uv pip install --python /opt/vllm/bin/python --no-cache-dir -U 'vllm[audio]' --torch-backend=auto --extra-index-url "${VLLM_EXTRA_INDEX}" \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --uid 10001 --create-home worker
COPY patch_moss_vllm_encoder_cache.py /tmp/patch_moss_vllm_encoder_cache.py
RUN /opt/vllm/bin/python /tmp/patch_moss_vllm_encoder_cache.py \
    && rm /tmp/patch_moss_vllm_encoder_cache.py
COPY entrypoint.sh /usr/local/bin/sokuji-moss-vllm
RUN chmod 0755 /usr/local/bin/sokuji-moss-vllm

USER worker
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/sokuji-moss-vllm"]
