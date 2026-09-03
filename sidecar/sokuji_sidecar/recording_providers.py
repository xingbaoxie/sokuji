"""Provider-neutral task orchestration for batch recording jobs.

All network credentials stay outside these payloads. A caller supplies an
already-authenticated RuntimeTaskClient (private runtime) or cloud adapter.
"""

import asyncio
from typing import Any, Protocol


class TaskApi(Protocol):
    async def get_task(self, task_id: str) -> dict[str, Any]: ...
    async def get_result(self, task_id: str) -> dict[str, Any]: ...
    async def cancel(self, task_id: str) -> dict[str, Any]: ...


class RecordingProviderError(RuntimeError):
    pass


async def wait_for_task(api: TaskApi, task_id: str, *, poll_seconds: float = 1.0, max_polls: int = 3600) -> dict[str, Any]:
    """Poll a Runtime-shaped task API with terminal-state handling in one place."""
    for _ in range(max_polls):
        task = await api.get_task(task_id)
        status = task.get("status")
        if status == "completed":
            return await api.get_result(task_id)
        if status in {"failed", "cancelled"}:
            error = task.get("error") or {}
            raise RecordingProviderError(error.get("message") or f"recording task {task_id} {status}")
        if status not in {"queued", "running", "waiting_remote"}:
            raise RecordingProviderError(f"recording task {task_id} returned unknown status {status!r}")
        await asyncio.sleep(poll_seconds)
    await api.cancel(task_id)
    raise RecordingProviderError(f"recording task {task_id} exceeded its polling budget")


class PrivateRuntimeProvider:
    """Private MOSS/FunASR path; the Runtime owns actual model worker selection."""

    def __init__(self, client):
        self._client = client

    async def transcribe(self, audio_path: str, profile_revision: str) -> dict[str, Any]:
        task = await self._client.submit_speech(audio_path, profile_revision)
        return await wait_for_task(self._client, task["taskId"])

    async def translate(self, payload: dict[str, Any]) -> dict[str, Any]:
        task = await self._client.submit("translation", payload)
        return await wait_for_task(self._client, task["taskId"])

    async def summarize(self, payload: dict[str, Any]) -> dict[str, Any]:
        task = await self._client.submit("summary", payload)
        return await wait_for_task(self._client, task["taskId"])
