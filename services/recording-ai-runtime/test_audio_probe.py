import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from audio_probe import AudioValidationError, inspect_audio, validate_audio


class AudioProbeTests(unittest.TestCase):
    def test_returns_minimal_media_facts(self):
        completed = subprocess.CompletedProcess(
            args=["ffprobe"], returncode=0,
            stdout='{"format":{"duration":"12.5"},"streams":[{"codec_type":"audio"}]}', stderr="",
        )
        with patch("audio_probe.subprocess.run", return_value=completed):
            self.assertEqual(inspect_audio(Path("meeting.m4a")), {"durationSeconds": 12.5})

    def test_rejects_unreadable_media(self):
        completed = subprocess.CompletedProcess(args=["ffprobe"], returncode=1, stdout="", stderr="invalid data")
        with patch("audio_probe.subprocess.run", return_value=completed):
            with self.assertRaisesRegex(AudioValidationError, "could not read") as raised:
                inspect_audio(Path("broken.m4a"))
        self.assertEqual(raised.exception.code, "AUDIO_UNREADABLE")

    def test_enforces_only_an_enabled_runtime_duration_limit(self):
        completed = subprocess.CompletedProcess(
            args=["ffprobe"], returncode=0,
            stdout='{"format":{"duration":"61"},"streams":[{"codec_type":"audio"}]}', stderr="",
        )
        with patch("audio_probe.subprocess.run", return_value=completed):
            with self.assertRaisesRegex(AudioValidationError, "limit") as raised:
                validate_audio(Path("long.m4a"), 60)
        self.assertEqual(raised.exception.code, "AUDIO_DURATION_EXCEEDED")


if __name__ == "__main__":
    unittest.main()
