import unittest

from upload_store import original_file_name, validate_audio_name


class UploadStoreTests(unittest.TestCase):
    def test_discards_untrusted_path_components(self):
        self.assertEqual(original_file_name("../../meeting.M4A"), "meeting.M4A")

    def test_allows_only_poc_audio_extensions(self):
        validate_audio_name("meeting.flac")
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            validate_audio_name("meeting.ogg")


if __name__ == "__main__":
    unittest.main()
