"""Temporary, operator-managed test configuration delivery.

The actual configuration file is deliberately outside source control.  This
module only defines its small wire contract and password verification.
"""

import base64
import binascii
import hashlib
import hmac
import json
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value.encode("ascii"))


def verify_scrypt_password(password: str, encoded: str) -> bool:
    """Verify ``scrypt$N$r$p$salt$derivedKey`` without leaking parse detail."""
    try:
        algorithm, n, r, p, salt, expected = encoded.split("$")
        if algorithm != "scrypt":
            return False
        derived = hashlib.scrypt(
            password.encode("utf-8"), salt=_b64decode(salt),
            n=int(n), r=int(r), p=int(p), dklen=len(_b64decode(expected)),
        )
        return hmac.compare_digest(derived, _b64decode(expected))
    except (ValueError, TypeError, UnicodeEncodeError, binascii.Error):
        return False


def validate_test_config(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("test configuration must be an object")
    if value.get("version") != 1 or not isinstance(value.get("revision"), str) or not value["revision"].strip():
        raise ValueError("test configuration version or revision is invalid")
    recording = value.get("recording")
    ast2 = value.get("volcengineAST2")
    if not isinstance(recording, dict) or not isinstance(ast2, dict):
        raise ValueError("test configuration sections are invalid")
    settings = recording.get("processingSettings")
    private_profiles = recording.get("privateProfiles")
    aliyun_profiles = recording.get("aliyunProfiles")
    if not isinstance(settings, dict) or not isinstance(private_profiles, dict) or not isinstance(aliyun_profiles, dict):
        raise ValueError("recording configuration is invalid")
    speech = settings.get("speech")
    translation = settings.get("translation")
    summary = settings.get("summary")
    if (
        settings.get("sourceLanguageMode") != "auto"
        or not isinstance(speech, dict)
        or speech.get("providerId") != "private-runtime"
        or speech.get("connectionProfileId") != "speech.private-moss"
        or speech.get("engineId") != "moss"
        or not isinstance(translation, dict)
        or translation.get("enabled") is not True
        or translation.get("providerId") != "aliyun-cloud"
        or translation.get("connectionProfileId") != "translation.aliyun"
        or not str(translation.get("modelId") or "").strip()
        or not isinstance(summary, dict)
        or summary.get("enabled") is not True
        or summary.get("providerId") != "aliyun-cloud"
        or summary.get("connectionProfileId") != "summary.aliyun"
        or not str(summary.get("modelId") or "").strip()
    ):
        raise ValueError("recording processing defaults are invalid")
    for profile_id in ("speech.private-moss", "speech.private-funasr"):
        profile = private_profiles.get(profile_id)
        if not isinstance(profile, dict) or not str(profile.get("runtimeBaseUrl") or "").strip() or not str(profile.get("token") or "").strip():
            raise ValueError("private runtime configuration is invalid")
    for profile_id in ("speech.aliyun", "translation.aliyun", "summary.aliyun"):
        profile = aliyun_profiles.get(profile_id)
        if not isinstance(profile, dict) or not str(profile.get("workspaceId") or "").strip() or not str(profile.get("dashscopeApiKey") or "").strip() or not str(profile.get("modelId") or "").strip():
            raise ValueError("Aliyun configuration is invalid")
    speech_aliyun = aliyun_profiles["speech.aliyun"]
    if not all(str(speech_aliyun.get(field) or "").strip() for field in ("ossBucket", "ossEndpoint", "ossAccessKeyId", "ossAccessKeySecret")):
        raise ValueError("Aliyun OSS configuration is invalid")
    if not str(ast2.get("apiKey") or "").strip():
        raise ValueError("AST2 configuration is invalid")
    return value


def load_test_config(file_path: Path) -> dict[str, Any]:
    return validate_test_config(json.loads(file_path.read_text(encoding="utf-8")))


class FailedLoginLimiter:
    """In-memory brake for the short-lived shared test account."""

    def __init__(self, *, max_failures: int = 5, window_seconds: int = 60):
        self._max_failures = max_failures
        self._window_seconds = window_seconds
        self._failures: dict[str, deque[float]] = defaultdict(deque)

    def blocked(self, client: str) -> bool:
        now = time.monotonic()
        failures = self._failures[client]
        while failures and now - failures[0] > self._window_seconds:
            failures.popleft()
        return len(failures) >= self._max_failures

    def failure(self, client: str) -> None:
        self._failures[client].append(time.monotonic())

    def success(self, client: str) -> None:
        self._failures.pop(client, None)
