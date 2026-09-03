import unittest

from sokuji_sidecar.recording_providers import RecordingProviderError, wait_for_task


class FakeTaskApi:
    def __init__(self, states):
        self.states = iter(states)
        self.cancelled = []

    async def get_task(self, _task_id):
        return next(self.states)

    async def get_result(self, task_id):
        return {"taskId": task_id, "segments": []}

    async def cancel(self, task_id):
        self.cancelled.append(task_id)


class RecordingProvidersTests(unittest.IsolatedAsyncioTestCase):
    async def test_waits_for_completion(self):
        api = FakeTaskApi([{"status": "queued"}, {"status": "completed"}])
        self.assertEqual(await wait_for_task(api, "speech_1", poll_seconds=0), {"taskId": "speech_1", "segments": []})

    async def test_surfaces_provider_error(self):
        api = FakeTaskApi([{"status": "failed", "error": {"message": "worker OOM"}}])
        with self.assertRaisesRegex(RecordingProviderError, "worker OOM"):
            await wait_for_task(api, "speech_1", poll_seconds=0)


if __name__ == "__main__":
    unittest.main()
