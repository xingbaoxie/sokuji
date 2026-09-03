#!/usr/bin/env python3
"""Patch the pinned vLLM MOSS adapter for long-audio encoder profiling.

vLLM's MOSS adapter profiles only one Whisper-size (30 second) chunk by
default. MOSS itself safely splits longer inputs into such chunks, but vLLM
then rejects those inputs because its encoder cache was allocated for a single
chunk. Keep the upstream implementation and make the cache budget configurable
for this POC's one-audio-per-request worker.

This is intentionally guarded by exact source snippets: a vLLM upgrade must
update this patch rather than silently changing adapter behaviour.
"""

from pathlib import Path


TARGET = Path(
    "/opt/vllm/lib/python3.12/site-packages/vllm/model_executor/models/"
    "moss_transcribe_diarize.py"
)
IMPORT_OLD = "import math\n"
IMPORT_NEW = "import math\nimport os\n"
BODY_OLD = """        feature_extractor = self.get_feature_extractor()
        max_audio_samples = _get_max_audio_samples(feature_extractor)
        max_audio_tokens = _compute_total_audio_tokens(
"""
BODY_NEW = """        feature_extractor = self.get_feature_extractor()
        # MOSS chunks long audio internally. Profile enough chunks for the
        # configured POC request duration so the vLLM encoder cache can hold
        # the resulting embedding sequence.
        configured_max_seconds = int(
            os.environ.get("SOKUJI_MOSS_ENCODER_CACHE_MAX_AUDIO_SECONDS", "3600")
        )
        if configured_max_seconds <= 0:
            raise ValueError(
                "SOKUJI_MOSS_ENCODER_CACHE_MAX_AUDIO_SECONDS must be positive"
            )
        max_audio_samples = max(
            _get_max_audio_samples(feature_extractor),
            configured_max_seconds * int(feature_extractor.sampling_rate),
        )
        max_audio_tokens = _compute_total_audio_tokens(
"""


def main() -> None:
    source = TARGET.read_text()
    if BODY_NEW in source:
        return
    if IMPORT_OLD not in source or BODY_OLD not in source:
        raise RuntimeError(f"Unsupported vLLM MOSS adapter layout: {TARGET}")
    source = source.replace(IMPORT_OLD, IMPORT_NEW, 1).replace(BODY_OLD, BODY_NEW, 1)
    TARGET.write_text(source)


if __name__ == "__main__":
    main()
