from pathlib import Path
import hashlib
from uuid import uuid4

ALLOWED_AUDIO_EXTENSIONS = {".m4a", ".mp3", ".wav", ".aac", ".flac"}
MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024


def original_file_name(value: str | None) -> str:
    name = Path(value or "recording.bin").name
    if not name or name in {".", ".."}:
        return "recording.bin"
    return name


def validate_audio_name(name: str) -> None:
    if Path(name).suffix.lower() not in ALLOWED_AUDIO_EXTENSIONS:
        raise ValueError("Unsupported audio file type")


async def save_uploaded_audio(upload, directory: Path) -> dict:
    """Persist an UploadFile without trusting its original path or MIME type."""
    name = original_file_name(upload.filename)
    validate_audio_name(name)
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / f"{uuid4().hex}{Path(name).suffix.lower()}"
    total = 0
    digest = hashlib.sha256()
    try:
        with destination.open("xb") as output:
            while chunk := await upload.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise ValueError("Audio upload exceeds the 4 GiB runtime limit")
                output.write(chunk)
                digest.update(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return {
        "inputPath": str(destination),
        "originalFileName": name,
        "contentType": upload.content_type or "application/octet-stream",
        "sizeBytes": total,
        "sha256": digest.hexdigest(),
    }


def remove_uploaded_audio(uploaded: dict | None) -> None:
    """Remove a rejected upload before it becomes an orphaned Runtime input."""
    if uploaded and uploaded.get("inputPath"):
        Path(uploaded["inputPath"]).unlink(missing_ok=True)
