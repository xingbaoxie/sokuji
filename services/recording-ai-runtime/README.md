# Sokuji Recording AI Runtime deployment

The Control API is containerized first with `SOKUJI_RUNTIME_FAKE=true`. This validates authentication, upload streaming, SQLite persistence, task polling, cancellation, and desktop connectivity without downloading a model. It records the selected profile, worker/model revision, upload checksum, lifecycle status, errors, and retention deadlines for every task.

The `moss-worker` and `funasr-worker` Compose profiles build isolated CUDA 13 Workers. Neither has a published port. On the 12 GB POC GPU they are mutually exclusive: keep `control-api` running, and start exactly one Worker with `./switch-speech-worker.sh moss` or `./switch-speech-worker.sh funasr`. The script refuses to start one while the other is running and never terminates an active model itself.

FunASR Meeting uses the pinned FunASR upstream commit `2b6294d69e6588a63c0ce06300f1b55ded71ae58`, `Fun-ASR-Nano-2512`, FSMN-VAD with a fixed 30-second maximum segment, ERes2NetV2 speaker attribution, and the upstream vLLM-only `/asr` service. Set `SOKUJI_FUNASR_WORKER_URL=http://funasr-worker:8000` only while that profile is active. Leave `SOKUJI_FUNASR_VALIDATED_MAX_DURATION_SEC=0` until its target-GPU benchmark passes; this intentionally hides FunASR from desktop live jobs.

On the server, copy `runtime.env.example` to `/opt/sokuji-recording-runtime/runtime.env`, create a high-entropy token in that file, then run `docker compose up -d --build control-api`.

## Temporary package-test configuration

For controlled package tests only, the desktop app can authenticate to
`POST /v1/test-config/load` and retrieve its recording and AST2 provider
configuration. Keep `SOKUJI_TEST_CONFIG_ENABLED=false` outside that test
window. Create a shared-account hash with `./generate_test_config_password_hash.py`, then put only the hash and username in `runtime.env`.

Copy `test-config.example.json` to the configured
`SOKUJI_TEST_CONFIG_FILE`, fill it on the server directly, and set its mode to
`600`. Neither the real JSON nor `runtime.env` belongs in Git. The endpoint
does not use the Runtime bearer token; it accepts only the short-lived shared
test account, so expose it only for the temporary controlled test described in
this repository.

The only intended POC listener is `192.168.50.186:8080`. Use the server firewall to restrict it to the desktop subnet. HTTP is temporary for the isolated private LAN; production must use internal HTTPS.

Uploads are removed after 7 days and task records/results after 30 days by the in-process retention loop. The values are configurable only through `runtime.env`; use a pinned MOSS commit hash in `SOKUJI_MOSS_MODEL_REVISION` after its benchmark gate passes.

When fake mode is disabled, the control API dispatches speech by engine. MOSS uses the internal `SOKUJI_MOSS_WORKER_URL` and its OpenAI-compatible transcription API. FunASR uses the internal `SOKUJI_FUNASR_WORKER_URL`, passes fixed-language hints and de-duplicated hotwords only when applicable, and normalizes `/asr` timestamp/speaker segments into the common result schema. The worker endpoint is never published to the LAN. Translation and summary remain unavailable in this private POC.
