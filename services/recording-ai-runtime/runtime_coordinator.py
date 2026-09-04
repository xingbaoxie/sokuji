import asyncio
from datetime import UTC, datetime
from uuid import uuid4

from task_store import TaskStore
from task_store import retention_deadlines


def now() -> str:
    return datetime.now(UTC).isoformat()


class RuntimeCoordinator:
    """Control-plane-only queue. A later worker adapter replaces _fake_execute."""

    def __init__(self, store: TaskStore, fake_runtime: bool, *, speech_executors=None, input_retention_days: int = 7, result_retention_days: int = 30):
        self._store = store
        self._fake_runtime = fake_runtime
        self._lease = asyncio.Semaphore(1)
        self._tasks: dict[str, asyncio.Task] = {}
        self._input_retention_days = input_retention_days
        self._result_retention_days = result_retention_days
        self._speech_executors = speech_executors or {}
        self._cancellation_requested: set[str] = set()

    async def submit(self, task_type: str, payload: dict, *, model: dict | None = None) -> dict:
        task_id = f"{task_type}_{uuid4().hex}"
        created_at = now()
        input_expires_at, cleanup_after = retention_deadlines(created_at, self._input_retention_days, self._result_retention_days)
        task = {
            "taskId": task_id, "type": task_type, "status": "queued", "payload": payload,
            "model": model or {}, "createdAt": created_at, "updatedAt": created_at,
            "inputExpiresAt": input_expires_at if payload.get("inputPath") else None,
            "cleanupAfter": cleanup_after,
        }
        self._store.create(task)
        self._tasks[task_id] = asyncio.create_task(self._execute(task_id, task_type, payload))
        return self._store.get(task_id)

    async def _execute(self, task_id: str, task_type: str, payload: dict) -> None:
        try:
            async with self._lease:
                self._store.update(task_id, status="running", updated_at=now())
                if not self._fake_runtime:
                    executor = self._speech_executors.get(payload.get("engine")) if task_type == "speech" else None
                    if executor:
                        result = await asyncio.to_thread(executor, payload["inputPath"], payload)
                        if task_id in self._cancellation_requested:
                            self._store.update(task_id, status="cancelled", updated_at=now())
                        else:
                            self._store.update(task_id, status="completed", updated_at=now(), result=result)
                        return
                    self._store.update(task_id, status="failed", updated_at=now(), error=("RUNTIME_NOT_CONFIGURED", "No model worker is configured."))
                    return
                await asyncio.sleep(0.25)
                result = self._fake_result(task_type, payload)
                self._store.update(task_id, status="completed", updated_at=now(), result=result)
        except asyncio.CancelledError:
            self._store.update(task_id, status="cancelled", updated_at=now())
            raise
        except Exception as error:
            if task_id in self._cancellation_requested:
                self._store.update(task_id, status="cancelled", updated_at=now())
            else:
                self._store.update(task_id, status="failed", updated_at=now(), error=("RUNTIME_EXECUTION_FAILED", str(error)))
        finally:
            self._tasks.pop(task_id, None)
            self._cancellation_requested.discard(task_id)

    def _fake_result(self, task_type: str, payload: dict) -> dict:
        if task_type == "speech":
            return {"segments": [{"id": "seg-0001", "startMs": 0, "endMs": 1200, "speakerId": "S01", "text": "Development runtime placeholder."}]}
        if task_type == "translation":
            return {"segments": [{**segment, "translatedText": f"[development] {segment['sourceText']}"} for segment in payload.get("segments", [])]}
        return {"summary": "Development runtime placeholder.", "topics": [], "decisions": [], "actions": [], "openQuestions": [], "risks": [], "facts": []}

    async def cancel(self, task_id: str) -> dict | None:
        task = self._store.get(task_id)
        if task is None:
            return None
        running = self._tasks.get(task_id)
        if task["status"] == "queued" and running:
            running.cancel()
            self._store.update(task_id, status="cancelled", updated_at=now())
        elif task["status"] == "running":
            # Model HTTP calls are synchronous in a worker thread.  Cancelling the
            # coroutine would release the GPU lease while the Worker still runs.
            self._cancellation_requested.add(task_id)
            self._store.update(task_id, status="cancelling", updated_at=now())
        elif task["status"] == "queued":
            self._store.update(task_id, status="cancelled", updated_at=now())
        return self._store.get(task_id)
