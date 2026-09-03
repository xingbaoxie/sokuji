import http.client
import json
import mimetypes
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4


LANGUAGE_LABELS = {"zh": "中文", "en": "English", "ja": "日文"}


def language_for_payload(payload: dict) -> str | None:
    if payload.get("sourceLanguageMode") != "fixed":
        return None
    value = payload.get("sourceLanguage")
    return LANGUAGE_LABELS.get(value, value if isinstance(value, str) and value else None)


def normalize_funasr_response(payload: dict) -> dict:
    # serve_vllm.py returns `segments` in seconds. FunASR sentence_info is
    # already expressed in milliseconds, including very early (<10s) turns.
    uses_sentence_info = not payload.get("segments") and bool(payload.get("sentence_info"))
    segments = payload.get("segments") or payload.get("sentence_info") or []
    normalized = []
    for index, segment in enumerate(segments, start=1):
        if not isinstance(segment, dict):
            continue
        start = segment.get("start", segment.get("begin_time", 0))
        end = segment.get("end", segment.get("end_time", start))
        multiplier = 1 if uses_sentence_info else 1000
        speaker = segment.get("speaker", segment.get("spk", segment.get("speaker_id", "unknown")))
        normalized.append({
            "id": f"seg-{index:04d}", "startMs": round(float(start or 0) * multiplier),
            "endMs": round(float(end or start or 0) * multiplier), "speakerId": str(speaker),
            "text": str(segment.get("text", "")).strip(),
        })
    if not normalized:
        raise RuntimeError("FunASR worker returned no timestamped speaker segments")
    return {"segments": normalized, "rawText": str(payload.get("text", ""))}


class FunAsrWorkerClient:
    """Streaming client for the pinned FunASR Meeting `/asr` Worker endpoint."""

    def __init__(self, base_url: str, *, timeout_seconds: int = 7200):
        parsed = urlparse(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("SOKUJI_FUNASR_WORKER_URL must be an http or https URL")
        self._parsed = parsed
        self._timeout_seconds = timeout_seconds

    def is_ready(self) -> bool:
        """The pinned FastAPI worker exposes its OpenAPI document after startup."""
        connection_type = http.client.HTTPSConnection if self._parsed.scheme == "https" else http.client.HTTPConnection
        connection = connection_type(self._parsed.hostname, self._parsed.port, timeout=5)
        endpoint = f"{self._parsed.path.rstrip('/')}/openapi.json"
        try:
            connection.request("GET", endpoint)
            return 200 <= connection.getresponse().status < 300
        except OSError:
            return False
        finally:
            connection.close()

    def transcribe(self, input_path: str, payload: dict) -> dict:
        source = Path(input_path)
        boundary = f"----sokuji-funasr-{uuid4().hex}"
        file_name = source.name.replace('"', "_")
        content_type = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
        fields = [("spk", "true"), ("timestamp", "true")]
        language = language_for_payload(payload)
        if language:
            fields.append(("language", language))
        hotwords = [str(value).strip() for value in payload.get("hotwords", []) if str(value).strip()]
        if hotwords:
            fields.append(("hotwords", ",".join(hotwords)))
        prefix = b"".join(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n".encode()
            for key, value in fields
        ) + (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\n"
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode()
        suffix = f"\r\n--{boundary}--\r\n".encode()
        connection_type = http.client.HTTPSConnection if self._parsed.scheme == "https" else http.client.HTTPConnection
        connection = connection_type(self._parsed.hostname, self._parsed.port, timeout=self._timeout_seconds)
        endpoint = f"{self._parsed.path.rstrip('/')}/asr"
        try:
            connection.putrequest("POST", endpoint)
            connection.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
            connection.putheader("Content-Length", str(len(prefix) + source.stat().st_size + len(suffix)))
            connection.putheader("Accept", "application/json")
            connection.endheaders()
            connection.send(prefix)
            with source.open("rb") as audio:
                while chunk := audio.read(1024 * 1024):
                    connection.send(chunk)
            connection.send(suffix)
            response = connection.getresponse()
            body = response.read()
        finally:
            connection.close()
        if response.status >= 400:
            raise RuntimeError(f"FunASR worker returned HTTP {response.status}: {body[:500].decode('utf-8', 'replace')}")
        try:
            return normalize_funasr_response(json.loads(body))
        except json.JSONDecodeError as error:
            raise RuntimeError("FunASR worker returned invalid JSON") from error
