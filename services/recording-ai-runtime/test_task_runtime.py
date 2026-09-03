import asyncio
import tempfile
import threading
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

from runtime_coordinator import RuntimeCoordinator
from task_store import TaskStore


class TaskStoreAndRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.store = TaskStore(Path(self.temporary_directory.name) / "tasks.sqlite3")

    async def asyncTearDown(self):
        self.temporary_directory.cleanup()

    async def test_fake_speech_task_is_durable_and_completes(self):
        coordinator = RuntimeCoordinator(self.store, fake_runtime=True)
        submitted = await coordinator.submit("speech", {"profileRevision": "dev", "inputPath": "/private/input.wav"})
        self.assertEqual(submitted["status"], "queued")
        await asyncio.sleep(0.3)
        result = self.store.get(submitted["taskId"])
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["result"]["segments"][0]["speakerId"], "S01")

    async def test_restart_marks_active_tasks_failed(self):
        created_at = datetime.now(UTC).isoformat()
        self.store.create({"taskId": "speech_active", "type": "speech", "status": "running", "payload": {}, "createdAt": created_at, "updatedAt": created_at})
        self.store.fail_interrupted_tasks(datetime.now(UTC).isoformat())
        task = self.store.get("speech_active")
        self.assertEqual(task["status"], "failed")
        self.assertEqual(task["error"]["code"], "RUNTIME_RESTARTED")

    async def test_persists_engine_and_runtime_provenance(self):
        created_at = datetime.now(UTC).isoformat()
        self.store.create({
            "taskId": "speech_funasr", "type": "speech", "status": "queued",
            "payload": {"profileRevision": "funasr-r1", "engine": "funasr-meeting"},
            "model": {"backend": "vllm", "id": "FunAudioLLM/Fun-ASR-Nano-2512"},
            "createdAt": created_at, "updatedAt": created_at,
        })
        task = self.store.get("speech_funasr")
        self.assertEqual(task["engine"], "funasr-meeting")
        self.assertEqual(task["backend"], "vllm")
        self.assertEqual(task["runtimeProfileRevision"], "funasr-r1")

    async def test_running_worker_cancel_keeps_task_cancelling_until_worker_returns(self):
        started = threading.Event()
        release = threading.Event()

        def execute(_input_path, _payload):
            started.set()
            release.wait(timeout=2)
            return {"segments": []}

        coordinator = RuntimeCoordinator(self.store, fake_runtime=False, speech_executors={"funasr-meeting": execute})
        submitted = await coordinator.submit("speech", {"profileRevision": "r1", "engine": "funasr-meeting", "inputPath": "/private/input.wav"})
        for _ in range(20):
            if started.is_set():
                break
            await asyncio.sleep(0.01)
        self.assertTrue(started.is_set())
        cancelling = await coordinator.cancel(submitted["taskId"])
        self.assertEqual(cancelling["status"], "cancelling")
        release.set()
        await asyncio.sleep(0.05)
        self.assertEqual(self.store.get(submitted["taskId"])["status"], "cancelled")

    async def test_retention_removes_only_managed_expired_uploads(self):
        inputs = Path(self.temporary_directory.name) / "inputs"
        inputs.mkdir()
        audio = inputs / "meeting.m4a"
        audio.write_bytes(b"audio")
        created_at = datetime.now(UTC).isoformat()
        self.store.create({
            "taskId": "speech_expired", "type": "speech", "status": "completed",
            "payload": {"profileRevision": "dev", "inputPath": str(audio)}, "model": {},
            "createdAt": created_at, "updatedAt": created_at,
            "inputExpiresAt": (datetime.now(UTC) - timedelta(seconds=1)).isoformat(),
            "cleanupAfter": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        })
        report = self.store.cleanup_expired(input_directory=inputs)
        self.assertEqual(report["deletedInputs"], 1)
        self.assertFalse(audio.exists())
        self.assertNotIn("inputPath", self.store.get("speech_expired")["payload"])


if __name__ == "__main__":
    unittest.main()
