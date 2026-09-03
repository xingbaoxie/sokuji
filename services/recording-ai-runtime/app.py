import asyncio
import json
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from runtime_coordinator import RuntimeCoordinator
from runtime_config import RuntimeConfig
from funasr_worker_client import FunAsrWorkerClient
from moss_worker_client import MossWorkerClient
from task_store import TaskStore
from upload_store import save_uploaded_audio

config = RuntimeConfig.from_environment()
store = TaskStore(config.data_root / "tasks" / "tasks.sqlite3")
speech_executors = {}
moss_worker = None
funasr_worker = None
if not config.fake_runtime and config.moss_worker_url:
    moss_worker = MossWorkerClient(
        config.moss_worker_url, model_id=config.moss_model_id,
        max_new_tokens=config.moss_max_new_tokens,
        timeout_seconds=config.moss_worker_timeout_seconds,
    )
    speech_executors["moss"] = moss_worker.transcribe
if not config.fake_runtime and config.funasr_worker_url:
    funasr_worker = FunAsrWorkerClient(config.funasr_worker_url, timeout_seconds=config.funasr_worker_timeout_seconds)
    speech_executors["funasr-meeting"] = funasr_worker.transcribe
coordinator = RuntimeCoordinator(
    store, fake_runtime=config.fake_runtime, speech_executors=speech_executors,
    input_retention_days=config.input_retention_days, result_retention_days=config.result_retention_days,
)


async def _retention_loop() -> None:
    while True:
        store.cleanup_expired(input_directory=config.data_root / "inputs")
        await asyncio.sleep(config.cleanup_interval_seconds)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    store.fail_interrupted_tasks(datetime.now(UTC).isoformat())
    cleanup_task = asyncio.create_task(_retention_loop())
    try:
        yield
    finally:
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Sokuji Recording AI Runtime", version="0.1.0", lifespan=lifespan)


def require_token(authorization: str | None = Header(default=None)) -> None:
    if not config.token or authorization != f"Bearer {config.token}":
        raise HTTPException(status_code=401, detail="Unauthorized")


class StageTask(BaseModel):
    profileRevision: str = Field(min_length=1)
    modelId: str | None = Field(default=None, min_length=1)
    payload: dict


@app.post("/v1/speech/tasks", dependencies=[Depends(require_token)])
async def submit_speech(
    profile_revision: str = Form(alias="profileRevision", min_length=1),
    engine: str = Form(),
    source_language_mode: str = Form(alias="sourceLanguageMode", default="auto"),
    source_language: str | None = Form(alias="sourceLanguage", default=None),
    hotwords: str = Form(default="[]"),
    audio: UploadFile = File(),
) -> dict:
    if engine not in {"moss", "funasr-meeting"}:
        raise HTTPException(status_code=422, detail="Unsupported speech engine")
    if source_language_mode not in {"auto", "fixed", "mixed"}:
        raise HTTPException(status_code=422, detail="Unsupported source language mode")
    if source_language_mode == "fixed" and not source_language:
        raise HTTPException(status_code=422, detail="Fixed source language is required")
    if source_language_mode != "fixed" and source_language:
        raise HTTPException(status_code=422, detail="sourceLanguage is allowed only for fixed source language mode")
    try:
        raw_hotwords = json.loads(hotwords)
        if not isinstance(raw_hotwords, list):
            raise TypeError("hotwords is not a list")
        parsed_hotwords = [str(word).strip() for word in raw_hotwords if str(word).strip()]
    except (TypeError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=422, detail="hotwords must be a JSON array") from error
    if len(parsed_hotwords) > 200:
        raise HTTPException(status_code=422, detail="At most 200 hotwords are allowed")
    profile = config.speech_profile(engine)
    if not config.fake_runtime and engine not in speech_executors:
        raise HTTPException(status_code=409, detail=f"Speech Worker {engine} is not enabled")
    try:
        uploaded = await save_uploaded_audio(audio, config.data_root / "inputs")
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    finally:
        await audio.close()
    return await coordinator.submit("speech", {
        "profileRevision": profile_revision, "engine": engine, "sourceLanguageMode": source_language_mode,
        **({"sourceLanguage": source_language} if source_language else {}), "hotwords": list(dict.fromkeys(parsed_hotwords)), **uploaded,
    }, model=profile)


@app.get("/v1/health")
def health() -> dict:
    mode = "fake" if config.fake_runtime else "ready" if speech_executors else "unconfigured"
    return {"status": "ok", "mode": mode, "profileRevision": config.profile_revision}


@app.get("/v1/capabilities", dependencies=[Depends(require_token)])
def capabilities() -> dict:
    moss = config.speech_profile("moss")
    funasr = config.speech_profile("funasr-meeting")
    moss["available"] = config.fake_runtime or bool(moss_worker and moss_worker.is_ready())
    # A running, configured FunASR Worker is ready for desktop jobs.  The
    # validated duration remains provenance for benchmark reporting; it must
    # not make a successfully started model look disabled in the desktop UI.
    funasr["available"] = config.fake_runtime or bool(funasr_worker and funasr_worker.is_ready())
    if not moss["available"] and not config.fake_runtime:
        moss["availabilityReason"] = "worker-unreachable"
    if not funasr["available"] and not config.fake_runtime:
        funasr["availabilityReason"] = "worker-unreachable"
    return {
        "speech": {"available": moss["available"] or funasr["available"], "moss": moss, "funasr-meeting": funasr},
        "runtimeProfileRevision": config.profile_revision, "translationModels": [], "summaryModels": [], "fakeRuntime": config.fake_runtime,
    }


@app.post("/v1/{task_type}/tasks", dependencies=[Depends(require_token)])
async def submit(task_type: str, request: StageTask) -> dict:
    if task_type not in {"translation", "summary"}:
        raise HTTPException(status_code=404, detail="Unsupported task type")
    model = config.model_for(task_type)
    if request.modelId:
        model = {**model, "id": request.modelId}
    return await coordinator.submit(task_type, {"profileRevision": request.profileRevision, **request.payload}, model=model)


@app.get("/v1/tasks/{task_id}", dependencies=[Depends(require_token)])
def get_task(task_id: str) -> dict:
    task = store.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    task.pop("payload", None)
    return task


@app.get("/v1/tasks/{task_id}/result", dependencies=[Depends(require_token)])
def get_result(task_id: str) -> dict:
    task = store.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["status"] != "completed":
        raise HTTPException(status_code=409, detail="Task is not completed")
    return task["result"]


@app.post("/v1/tasks/{task_id}/cancel", dependencies=[Depends(require_token)])
async def cancel(task_id: str) -> dict:
    task = await coordinator.cancel(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    task.pop("payload", None)
    return task
