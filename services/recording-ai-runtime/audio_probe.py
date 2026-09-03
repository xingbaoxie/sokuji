"""Media validation owned by the Runtime control API."""

import json
import subprocess
from pathlib import Path


class AudioValidationError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def inspect_audio(path: Path, *, command: str = "ffprobe") -> dict:
    """Return minimal media facts or a stable, user-safe validation error."""
    try:
        completed = subprocess.run(
            [command, "-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type", "-of", "json", str(path)],
            check=False, capture_output=True, text=True, timeout=30,
        )
    except FileNotFoundError as error:
        raise RuntimeError("Runtime media validator is unavailable") from error
    except subprocess.TimeoutExpired as error:
        raise AudioValidationError("AUDIO_UNREADABLE", "Runtime could not read the audio file") from error
    if completed.returncode != 0:
        raise AudioValidationError("AUDIO_UNREADABLE", "Runtime could not read the audio file")
    try:
        payload = json.loads(completed.stdout)
        duration = float(payload.get("format", {}).get("duration", 0))
        has_audio = any(stream.get("codec_type") == "audio" for stream in payload.get("streams", []))
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise AudioValidationError("AUDIO_UNREADABLE", "Runtime could not read the audio file") from error
    if not has_audio or duration <= 0:
        raise AudioValidationError("AUDIO_UNREADABLE", "Runtime could not read the audio file")
    return {"durationSeconds": duration}


def validate_audio(path: Path, max_duration_seconds: int) -> dict:
    metadata = inspect_audio(path)
    if max_duration_seconds > 0 and metadata["durationSeconds"] > max_duration_seconds:
        raise AudioValidationError("AUDIO_DURATION_EXCEEDED", f"Recording exceeds the Runtime limit of {max_duration_seconds} seconds")
    return metadata
