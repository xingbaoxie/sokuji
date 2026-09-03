import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from moss_worker_client import MossWorkerClient, parse_moss_response


class _FakeResponse:
    status = 200

    def read(self):
        return b'{"text":"[0.0][S01]Hello[1.0]"}'


class _FakeConnection:
    def __init__(self):
        self.sent = []
        self.requests = []

    def request(self, *args):
        self.requests.append(args)

    def putrequest(self, *_args):
        pass

    def putheader(self, *_args):
        pass

    def endheaders(self):
        pass

    def send(self, data):
        self.sent.append(data)

    def getresponse(self):
        return _FakeResponse()

    def close(self):
        pass


class MossWorkerClientTests(unittest.TestCase):
    def test_ready_probe_uses_vllm_health_endpoint(self):
        connection = _FakeConnection()
        with patch("moss_worker_client.http.client.HTTPConnection", return_value=connection):
            self.assertTrue(MossWorkerClient("http://worker:8000", model_id="moss", max_new_tokens=32).is_ready())
        self.assertEqual(connection.requests, [("GET", "/health")])

    def test_normalizes_verbose_segments(self):
        result = parse_moss_response({"text": "raw", "segments": [{"start": 0.48, "end": 1.66, "speaker": "S01", "text": "Hello"}]})
        self.assertEqual(result["segments"], [{"id": "seg-0001", "startMs": 480, "endMs": 1660, "speakerId": "S01", "text": "Hello"}])

    def test_parses_moss_canonical_text(self):
        result = parse_moss_response({"text": "[0.48][S01]Welcome[1.66]"})
        self.assertEqual(result["segments"][0]["speakerId"], "S01")
        self.assertEqual(result["segments"][0]["endMs"], 1660)

    def test_requests_json_not_unsupported_verbose_json(self):
        connection = _FakeConnection()
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / "sample.mp3"
            audio.write_bytes(b"audio")
            with patch("moss_worker_client.http.client.HTTPConnection", return_value=connection):
                result = MossWorkerClient("http://worker:8000", model_id="moss", max_new_tokens=32).transcribe(str(audio))

        request = b"".join(connection.sent)
        self.assertIn(b'name="response_format"\r\n\r\njson\r\n', request)
        self.assertNotIn(b"verbose_json", request)
        self.assertIn(b'name="max_completion_tokens"\r\n\r\n32\r\n', request)
        self.assertNotIn(b'name="max_new_tokens"', request)
        self.assertEqual(result["segments"][0]["text"], "Hello")


if __name__ == "__main__":
    unittest.main()
