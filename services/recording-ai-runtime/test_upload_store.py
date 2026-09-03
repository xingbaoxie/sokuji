import tempfile
import unittest
from pathlib import Path

from upload_store import original_file_name, remove_uploaded_audio, validate_audio_name


class UploadStoreTests(unittest.TestCase):
    def test_discards_untrusted_path_components(self):
        self.assertEqual(original_file_name("../../meeting.M4A"), "meeting.M4A")

    def test_allows_only_poc_audio_extensions(self):
        validate_audio_name("meeting.flac")
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            validate_audio_name("meeting.ogg")

    def test_removes_rejected_uploaded_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rejected.m4a"
            path.write_bytes(b"not-audio")
            remove_uploaded_audio({"inputPath": str(path)})
            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
