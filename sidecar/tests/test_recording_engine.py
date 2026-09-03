import unittest

from sokuji_sidecar.recording_engine import _status


class RecordingEngineTests(unittest.IsolatedAsyncioTestCase):
    async def test_status_requires_the_main_process_token(self):
        state = {"recording_token": "main-only", "recording_runtime_configured": False}
        denied, _ = await _status(state, {"id": 1, "token": "renderer-does-not-know-this"}, None)
        self.assertEqual(denied["type"], "error")
        accepted, _ = await _status(state, {"id": 2, "token": "main-only"}, None)
        self.assertEqual(accepted, {"type": "recording_status_result", "id": 2, "available": False, "message": "runtime code installed; no model runtime configured"})


if __name__ == "__main__":
    unittest.main()
