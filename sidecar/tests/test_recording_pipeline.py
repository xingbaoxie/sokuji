import unittest

from sokuji_sidecar.recording_pipeline import (
    build_srt,
    decode_translation_batch,
    make_translation_batches,
    validate_summary_citations,
)


class RecordingPipelineTests(unittest.TestCase):
    def test_translation_batches_preserve_segment_identity(self):
        batches = make_translation_batches([
            {"id": "seg-1", "text": "hello"},
            {"id": "seg-2", "text": "world"},
        ], max_characters=64)
        self.assertEqual(batches[0]["segmentIds"], ["seg-1", "seg-2"])
        self.assertEqual(
            decode_translation_batch("[[SEG:seg-1]] 你好\n[[SEG:seg-2]] 世界", batches[0]["segmentIds"]),
            {"seg-1": "你好", "seg-2": "世界"},
        )

    def test_translation_rejects_lost_markers(self):
        with self.assertRaisesRegex(ValueError, "preserve"):
            decode_translation_batch("[[SEG:seg-1]] translated", ["seg-1", "seg-2"])

    def test_summary_citations_must_come_from_source(self):
        summary = {"facts": [{"text": "fact", "sourceSegmentIds": ["seg-1"]}], "actions": [], "decisions": [], "openQuestions": [], "risks": []}
        self.assertIs(validate_summary_citations(summary, {"seg-1"}), summary)
        summary["facts"][0]["sourceSegmentIds"] = ["invented"]
        with self.assertRaisesRegex(ValueError, "unknown"):
            validate_summary_citations(summary, {"seg-1"})

    def test_srt_uses_stable_timestamps(self):
        self.assertEqual(build_srt([{"startMs": 0, "endMs": 1200, "text": "Hello"}]), "1\n00:00:00,000 --> 00:00:01,200\nHello\n")
