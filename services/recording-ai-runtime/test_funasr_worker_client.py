import unittest
from unittest.mock import patch

from funasr_worker_client import FunAsrWorkerClient, language_for_payload, normalize_funasr_response


class _ReadyResponse:
    status = 200


class _ReadyConnection:
    def request(self, *_args):
        pass

    def getresponse(self):
        return _ReadyResponse()

    def close(self):
        pass


class FunAsrWorkerClientTests(unittest.TestCase):
    def test_ready_probe_uses_fastapi_openapi_endpoint(self):
        connection = _ReadyConnection()
        with patch("funasr_worker_client.http.client.HTTPConnection", return_value=connection):
            self.assertTrue(FunAsrWorkerClient("http://worker:8000").is_ready())

    def test_maps_only_fixed_supported_language(self):
        self.assertEqual(language_for_payload({"sourceLanguageMode": "fixed", "sourceLanguage": "zh"}), "中文")
        self.assertIsNone(language_for_payload({"sourceLanguageMode": "mixed", "sourceLanguage": "zh"}))

    def test_normalizes_official_asr_seconds_and_speaker(self):
        result = normalize_funasr_response({
            "text": "hello", "segments": [{"start": 1.7, "end": 14.8, "speaker": "SPK0", "text": "hello"}],
        })
        self.assertEqual(result["segments"], [{"id": "seg-0001", "startMs": 1700, "endMs": 14800, "speakerId": "SPK0", "text": "hello"}])

    def test_preserves_early_sentence_info_milliseconds(self):
        result = normalize_funasr_response({
            "sentence_info": [{"start": 0, "end": 5000, "spk": 1, "text": "早期片段"}],
        })
        self.assertEqual(result["segments"][0]["endMs"], 5000)
        self.assertEqual(result["segments"][0]["speakerId"], "1")


if __name__ == "__main__":
    unittest.main()
