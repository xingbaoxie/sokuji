import http.client
import json
import mimetypes
import re
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4


_CANONICAL_SEGMENT = re.compile(r"\[(?P<start>\d+(?:\.\d+)?)\]\[(?P<speaker>S\d+)\](?P<text>.*?)\[(?P<end>\d+(?:\.\d+)?)\]", re.DOTALL)


def _milliseconds(value: object) -> int:
    return round(float(value) * 1000)


def parse_moss_response(payload: dict) -> dict:
    """Normalize MOSS JSON output or its canonical text for the control API."""
    raw_segments = payload.get("segments")
    if isinstance(raw_segments, list):
        segments = []
        for index, segment in enumerate(raw_segments):
            if not isinstance(segment, dict):
                continue
            start = segment.get("start", segment.get("start_time", 0))
            end = segment.get("end", segment.get("end_time", start))
            segments.append({
                "id": str(segment.get("id", f"seg-{index + 1:04d}")),
                "startMs": _milliseconds(start), "endMs": _milliseconds(end),
                "speakerId": str(segment.get("speaker", segment.get("speaker_id", "unknown"))),
                "text": str(segment.get("text", "")).strip(),
            })
        if segments:
            return {"segments": segments, "rawText": str(payload.get("text", ""))}
    text = str(payload.get("text", ""))
    segments = [
        {
            "id": f"seg-{index:04d}", "startMs": _milliseconds(match.group("start")),
            "endMs": _milliseconds(match.group("end")), "speakerId": match.group("speaker"),
            "text": match.group("text").strip(),
        }
        for index, match in enumerate(_CANONICAL_SEGMENT.finditer(text), start=1)
    ]
    if not segments:
        raise RuntimeError("MOSS worker returned no parseable diarized segments")
    return {"segments": segments, "rawText": text}


class MossWorkerClient:
    """Streaming OpenAI-compatible client for the isolated SGLang/vLLM MOSS worker."""

    def __init__(self, base_url: str, *, model_id: str, max_new_tokens: int, timeout_seconds: int = 7200):
        parsed = urlparse(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("SOKUJI_MOSS_WORKER_URL must be an http or https URL")
        self._parsed = parsed
        self._model_id = model_id
        self._max_new_tokens = max_new_tokens
        self._timeout_seconds = timeout_seconds

    def is_ready(self) -> bool:
        """Return whether the vLLM Worker itself is accepting requests."""
        connection_type = http.client.HTTPSConnection if self._parsed.scheme == "https" else http.client.HTTPConnection
        connection = connection_type(self._parsed.hostname, self._parsed.port, timeout=5)
        endpoint = f"{self._parsed.path.rstrip('/')}/health"
        try:
            connection.request("GET", endpoint)
            return 200 <= connection.getresponse().status < 300
        except OSError:
            return False
        finally:
            connection.close()

    def transcribe(self, input_path: str, _payload: dict | None = None) -> dict:
        source = Path(input_path)
        file_size = source.stat().st_size
        boundary = f"----sokuji-moss-{uuid4().hex}"
        file_name = source.name.replace('"', "_")
        content_type = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
        prefix = (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{self._model_id}\r\n"
            # MOSS vLLM supports OpenAI-compatible JSON, but explicitly
            # rejects Whisper's verbose_json response format.
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"response_format\"\r\n\r\njson\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"temperature\"\r\n\r\n0\r\n"
            # vLLM's transcription API calls this max_completion_tokens.
            # max_new_tokens is silently ignored, which truncates long audio.
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"max_completion_tokens\"\r\n\r\n{self._max_new_tokens}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: {content_type}\r\n\r\n"
        ).encode()
        suffix = f"\r\n--{boundary}--\r\n".encode()
        connection_type = http.client.HTTPSConnection if self._parsed.scheme == "https" else http.client.HTTPConnection
        connection = connection_type(self._parsed.hostname, self._parsed.port, timeout=self._timeout_seconds)
        endpoint = f"{self._parsed.path.rstrip('/')}/v1/audio/transcriptions"
        try:
            connection.putrequest("POST", endpoint)
            connection.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
            connection.putheader("Content-Length", str(len(prefix) + file_size + len(suffix)))
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
            raise RuntimeError(f"MOSS worker returned HTTP {response.status}: {body[:500].decode('utf-8', 'replace')}")
        try:
            return parse_moss_response(json.loads(body))
        except json.JSONDecodeError as error:
            raise RuntimeError("MOSS worker returned invalid JSON") from error
