# Recording AI Runtime preflight

This checklist prepares the Linux private runtime for the V4 recording-transcription POC. It deliberately does not install MOSS, FunASR, or text models; model deployment starts only after the machine passes this preflight.

## Current POC baseline

- [x] `192.168.50.186` runs Ubuntu 26.04 with an RTX 3060 12 GB, Docker Compose, NVIDIA Container Toolkit, and a successful GPU-container visibility check.
- [x] The control API is listening only on `192.168.50.186:8080`, requires a Runtime token for task/capability endpoints, and is currently in explicit fake mode.
- [x] Docker Hub access uses the configured DaoCloud registry mirror. Docker log rotation is bounded by the Compose configuration.
- [x] The host firewall is currently inactive. Do not enable it as part of this POC without approving its complete SSH and desktop-subnet policy; the Compose listener binding is the current exposure boundary.
- [x] Input retention is 7 days, task/result retention is 30 days, maximum upload size is 4 GiB, and the control-plane GPU lease is one.

## External dependency register

The desktop app can run a complete simulated task lifecycle before any item below is available. The following items are deliberately configuration/deployment work, not blockers for local code development:

| Item | Required for | Owner / input needed |
| --- | --- | --- |
| Linux GPU host and Runtime URL | Private MOSS/FunASR execution | Infrastructure |
| Runtime token and TLS/CA policy | Authenticated desktop-to-Runtime calls | Security / Infrastructure |
| MOSS, FunASR and summary-model artefacts | Real model worker execution | ML / Licensing |
| OSS bucket, RAM policy and Filetrans credentials | Aliyun Cloud scheme | Cloud account owner |
| Retention and concurrency policy | Production task cleanup and GPU lease settings | Product / Operations |

Until these values are supplied, use the **Run simulated job** action. It persists a Job, creates simulated remote task IDs, exercises polling and stage transitions, and produces the same local output artifact shapes without contacting a network service.

## 1. Host and network

- [ ] Linux host is assigned a stable internal DNS name and private IP address.
- [ ] NVIDIA GPU, driver, and `nvidia-smi` are healthy under the service account.
- [ ] Docker Engine and NVIDIA Container Toolkit are installed, or an equivalent isolated-runtime mechanism is approved.
- [x] The desktop network can reach the Runtime HTTP POC endpoint; public Internet exposure is not required.
- [ ] TLS certificate, DNS name, and firewall rule for the Runtime HTTPS port are prepared before production.
- [ ] A least-privilege Runtime service token is created. It is stored by Electron Main, never in a recording Job artifact.

## 2. Storage layout

Create one service-owned root with restrictive permissions. Keep these directories on a volume sized for concurrent original audio uploads plus result retention:

```text
/var/lib/sokuji-recording-runtime/
  tasks/       # SQLite task store
  inputs/      # private, TTL-cleaned uploaded recordings
  results/     # private, TTL-cleaned task output JSON
  logs/        # redacted service and worker logs
  models/      # model cache; added only after Phase 0 begins
```

- [ ] The service account owns the root and no desktop user has direct access.
- [ ] Input and result TTLs, maximum upload bytes, and disk-watermark alerts are set before accepting uploads.
- [ ] Backup policy covers `tasks/` only; raw recordings and results follow the approved retention policy instead.

## 3. Runtime service contract

The service exposes only these authenticated endpoints in the POC:

```text
GET  /v1/health
GET  /v1/capabilities
POST /v1/speech/tasks
POST /v1/translation/tasks
POST /v1/summary/tasks
GET  /v1/tasks/{taskId}
GET  /v1/tasks/{taskId}/result
POST /v1/tasks/{taskId}/cancel
```

- [ ] All task/capability endpoints require the Runtime token; `taskId` is not an authorization credential. Health is intentionally unauthenticated for container orchestration.
- [ ] Uploads stream to a unique task directory and are size-limited; no handler loads a complete recording into memory.
- [ ] Every task records its profile revision, engine/model revision, input checksum, result schema version, and cleanup deadline.
- [ ] The Control API does not load MOSS, FunASR, or text model libraries.

## 4. Isolation and observability

- [ ] MOSS, FunASR Meeting, and Text Runtime have separate containers or venvs.
- [ ] Workers receive an input file path and output path, never large PCM buffers through process IPC.
- [ ] A worker crash, OOM, cancel, and forced timeout are tested without terminating the Control API.
- [ ] `HeavyGpuLease=1` is enforced before model deployment; a lease is released only after its worker exits.
- [ ] Logs redact `Authorization`, bearer tokens, and cloud credentials.

## 5. Readiness gate for model Phase 0

Do not deploy a model until all items below are true:

- [ ] `GET /v1/health` reports the expected GPU and CUDA availability.
- [ ] An authenticated fake speech task can be submitted, polled, cancelled, and read after a desktop-app restart.
- [ ] Input/result TTL cleanup is observed in a disposable environment.
- [ ] The Runtime profile revision is visible from `/v1/capabilities` and recorded on every task.
- [ ] Model license approval, download source, and disk budget are recorded for the selected MOSS/FunASR/Text benchmark candidates.

### MOSS benchmark freeze record

The model card identifies `OpenMOSS-Team/MOSS-Transcribe-Diarize` as Apache-2.0 and recommends an OpenAI-compatible SGLang Omni transcription endpoint on CUDA 13. It supports `verbose_json` output for speaker segments and documents increasing `max_new_tokens` for long diarized recordings. Before any download or Worker start, record all of the following in the deployment change:

- [ ] Immutable Hugging Face model commit, full file checksum manifest, source URL, and license approval.
- [ ] Immutable SGLang Omni (or CUDA 13 vLLM) image digest; never use a floating tag.
- [ ] Exact Worker command, `response_format=verbose_json`, temperature `0`, and long-audio token limit.
- [ ] 30, 60, and 90 minute benchmark results: elapsed time, peak VRAM, GPU utilization, output completeness, CER/cpCER sample review, and failure/OOM behavior.
- [ ] The first Worker has no host port. Only the control API may access it, and only one heavy GPU Worker runs at a time.

The control API code already contains an internal OpenAI-compatible MOSS Worker client. With fake mode disabled it streams an input to `SOKUJI_MOSS_WORKER_URL`, requests `verbose_json`, and normalizes worker segments or MOSS's timestamp/speaker format. Keeping that URL empty deliberately makes a non-fake Runtime fail closed until the above record is complete.

## Handoff information needed from infrastructure

Provide these values when the server is ready:

```text
runtime base URL:
TLS CA / certificate handling:
Runtime token delivery mechanism:
Linux distribution and version:
GPU model, VRAM, driver version, CUDA version:
available disk for inputs/results/models:
container runtime choice:
raw-audio retention TTL:
result retention TTL:
maximum upload size:
```
