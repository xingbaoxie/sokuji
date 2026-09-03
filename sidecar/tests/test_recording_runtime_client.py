import unittest

from sokuji_sidecar.recording_runtime_client import RuntimeTaskClient


class RuntimeTaskClientTests(unittest.TestCase):
    def test_refuses_non_http_runtime_url_and_empty_token(self):
        with self.assertRaisesRegex(ValueError, "http"):
            RuntimeTaskClient("file:///runtime", "token")
        with self.assertRaisesRegex(ValueError, "token"):
            RuntimeTaskClient("http://runtime.local", "")


if __name__ == "__main__":
    unittest.main()
