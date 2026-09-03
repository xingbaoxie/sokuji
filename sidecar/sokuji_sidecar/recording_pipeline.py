"""Pure batch-recording helpers shared by the future Recording Engine and tests.

This module deliberately does not load a model. It makes provider output safe to
persist: segment identity survives batched translation, and a generated summary
may only cite transcript segment IDs that actually exist.
"""

import re
from typing import Any

_MARKER = re.compile(r"^\[\[SEG:([A-Za-z0-9_-]+)\]\]\s?(.*)$", re.MULTILINE)


def make_translation_batches(segments: list[dict[str, Any]], max_characters: int = 6000) -> list[dict[str, Any]]:
    if max_characters < 64:
        raise ValueError("max_characters must be at least 64")
    batches: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []
    current_size = 0
    for segment in segments:
        segment_id = segment.get("id")
        text = segment.get("text")
        if not isinstance(segment_id, str) or not isinstance(text, str):
            raise ValueError("every transcript segment requires string id and text")
        marked = f"[[SEG:{segment_id}]] {text}".strip()
        if len(marked) > max_characters:
            raise ValueError(f"segment {segment_id} is too large for one translation request")
        if current and current_size + len(marked) + 1 > max_characters:
            batches.append({"segmentIds": [item["id"] for item in current], "text": "\n".join(item["marked"] for item in current)})
            current, current_size = [], 0
        current.append({"id": segment_id, "marked": marked})
        current_size += len(marked) + 1
    if current:
        batches.append({"segmentIds": [item["id"] for item in current], "text": "\n".join(item["marked"] for item in current)})
    return batches


def decode_translation_batch(translated_text: str, expected_ids: list[str]) -> dict[str, str]:
    parsed = {segment_id: text.strip() for segment_id, text in _MARKER.findall(translated_text)}
    if set(parsed) != set(expected_ids):
        raise ValueError("translated batch did not preserve every segment marker exactly once")
    return {segment_id: parsed[segment_id] for segment_id in expected_ids}


def validate_summary_citations(summary: dict[str, Any], source_segment_ids: set[str]) -> dict[str, Any]:
    """Reject report facts/actions that cite invented transcript IDs."""
    for section in ("facts", "actions", "decisions", "openQuestions", "risks"):
        entries = summary.get(section, [])
        if not isinstance(entries, list):
            raise ValueError(f"summary section {section} must be a list")
        for entry in entries:
            if not isinstance(entry, dict):
                raise ValueError(f"summary entry in {section} must be an object")
            citations = entry.get("sourceSegmentIds", [])
            if not isinstance(citations, list) or any(citation not in source_segment_ids for citation in citations):
                raise ValueError(f"summary contains an unknown source segment id in {section}")
    return summary


def srt_timestamp(milliseconds: int) -> str:
    milliseconds = max(0, milliseconds)
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, milliseconds = divmod(remainder, 1_000)
    return f"{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}"


def build_srt(segments: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for index, segment in enumerate(segments, start=1):
        lines.extend((str(index), f"{srt_timestamp(int(segment['startMs']))} --> {srt_timestamp(int(segment['endMs']))}", segment["text"], ""))
    return "\n".join(lines)
