FROM nvidia/cuda:13.0.0-runtime-ubuntu24.04

ARG FUNASR_UPSTREAM_COMMIT=2b6294d69e6588a63c0ce06300f1b55ded71ae58
ENV DEBIAN_FRONTEND=noninteractive \
    VIRTUAL_ENV=/opt/funasr-venv \
    PATH=/opt/funasr-venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates ffmpeg git libsndfile1 python3 python3-dev python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv "$VIRTUAL_ENV" \
    && "$VIRTUAL_ENV/bin/pip" install --no-cache-dir --upgrade pip==25.3

COPY requirements.lock /tmp/requirements.lock
RUN PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple \
      pip install --no-cache-dir --requirement /tmp/requirements.lock \
    && git clone https://github.com/modelscope/FunASR.git /opt/FunASR \
    && git -C /opt/FunASR checkout --detach "$FUNASR_UPSTREAM_COMMIT" \
    && pip install --no-cache-dir --no-deps -e /opt/FunASR \
    && useradd --system --create-home --uid 10001 funasr \
    && chown -R funasr:funasr /opt/FunASR /opt/funasr-venv

COPY entrypoint.sh /usr/local/bin/sokuji-funasr-worker
RUN chmod 0555 /usr/local/bin/sokuji-funasr-worker
USER funasr
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/sokuji-funasr-worker"]
