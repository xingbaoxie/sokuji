"""Client for the isolated Linux Recording AI Runtime task API.

Secrets are supplied by the Electron main process to the calling engine only;
they are never part of a renderer message or a persisted recording job.
"""

import asyncio
import http.client
import json
from pathlib import Path
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlsplit


class RuntimeClientError(RuntimeError):
    pass


@dataclass(frozen=True)
class RuntimeTaskClient:
    base_url: str
    bearer_token: str
    timeout_seconds: float = 30.0

    def __post_init__(self):
        if not self.base_url.startswith(("http://", "https://")):
            raise ValueError("Runtime base URL must use http or https")
        if not self.bearer_token:
            raise ValueError("Runtime bearer token is required")

    async def capabilities(self) -> dict[str, Any]:
        return await self._request("GET", "/v1/capabilities")

    async def submit(self, task_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        if task_type not in {"translation", "summary"}:
            raise ValueError("Use the multipart speech uploader for speech tasks")
        return await self._request("POST", f"/v1/{task_type}/tasks", payload)

    async def submit_speech(self, audio_path: str, profile_revision: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._submit_speech_sync, audio_path, profile_revision)

    async def get_task(self, task_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/v1/tasks/{task_id}")

    async def get_result(self, task_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/v1/tasks/{task_id}/result")

    async def cancel(self, task_id: str) -> dict[str, Any]:
        return await self._request("POST", f"/v1/tasks/{task_id}/cancel")

    async def _request(self, method: str, request_path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        return await asyncio.to_thread(self._request_sync, method, request_path, body)

    def _request_sync(self, method: str, request_path: str, body: dict[str, Any] | None) -> dict[str, Any]:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = Request(
            f"{self.base_url.rstrip('/')}{request_path}",
            data=data,
            method=method,
            headers={"Authorization": f"Bearer {self.bearer_token}", "Accept": "application/json", **({"Content-Type": "application/json"} if data else {})},
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeClientError(f"Runtime request failed with HTTP {error.code}: {detail}") from error
        except URLError as error:
            raise RuntimeClientError(f"Runtime request could not be reached: {error.reason}") from error

    def _submit_speech_sync(self, audio_path: str, profile_revision: str) -> dict[str, Any]:
        source = Path(audio_path)
        if not source.is_file() or not profile_revision:
            raise ValueError("A readable audio path and profile revision are required")
        parsed = urlsplit(self.base_url)
        if parsed.query or parsed.fragment:
            raise ValueError("Runtime base URL must not contain a query or fragment")
        boundary = "----sokuji-runtime-upload"
        filename = source.name.replace('"', "_")
        prefix = (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"profileRevision\"\r\n\r\n{profile_revision}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"{filename}\"\r\n"
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode("utf-8")
        suffix = f"\r\n--{boundary}--\r\n".encode("utf-8")
        connection_class = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
        connection = connection_class(parsed.netloc, timeout=self.timeout_seconds)
        request_path = f"{parsed.path.rstrip('/')}/v1/speech/tasks" or "/v1/speech/tasks"
        try:
            connection.putrequest("POST", request_path)
            connection.putheader("Authorization", f"Bearer {self.bearer_token}")
            connection.putheader("Accept", "application/json")
            connection.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
            connection.putheader("Content-Length", str(len(prefix) + source.stat().st_size + len(suffix)))
            connection.endheaders()
            connection.send(prefix)
            with source.open("rb") as audio:
                while chunk := audio.read(1024 * 1024):
                    connection.send(chunk)
            connection.send(suffix)
            response = connection.getresponse()
            response_body = response.read().decode("utf-8", errors="replace")
            if response.status >= 400:
                raise RuntimeClientError(f"Runtime request failed with HTTP {response.status}: {response_body[:500]}")
            return json.loads(response_body)
        except OSError as error:
            raise RuntimeClientError(f"Runtime speech upload failed: {error}") from error
        finally:
            connection.close()
