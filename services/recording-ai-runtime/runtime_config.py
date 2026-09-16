import os
from dataclasses import dataclass
from pathlib import Path


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be a positive integer") from error
    if value < 1:
        raise RuntimeError(f"{name} must be a positive integer")
    return value


def _non_negative_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be a non-negative integer") from error
    if value < 0:
        raise RuntimeError(f"{name} must be a non-negative integer")
    return value


@dataclass(frozen=True)
class RuntimeConfig:
    data_root: Path
    token: str
    fake_runtime: bool
    profile_revision: str
    input_retention_days: int
    result_retention_days: int
    cleanup_interval_seconds: int
    moss_model_id: str
    moss_model_revision: str
    moss_worker_url: str
    moss_worker_timeout_seconds: int
    moss_max_new_tokens: int
    moss_validated_max_duration_sec: int
    funasr_model_id: str
    funasr_model_revision: str
    funasr_vad_model_id: str
    funasr_vad_model_revision: str
    funasr_speaker_model_id: str
    funasr_speaker_model_revision: str
    funasr_worker_url: str
    funasr_worker_timeout_seconds: int
    funasr_vad_max_single_segment_time_ms: int
    funasr_gpu_memory_utilization: float
    funasr_validated_max_duration_sec: int
    test_config_enabled: bool
    test_config_username: str
    test_config_password_hash: str
    test_config_file: Path

    @classmethod
    def from_environment(cls) -> "RuntimeConfig":
        return cls(
            data_root=Path(os.getenv("SOKUJI_RUNTIME_DATA", "/var/lib/sokuji-recording-runtime")),
            token=os.getenv("SOKUJI_RUNTIME_TOKEN", ""),
            fake_runtime=os.getenv("SOKUJI_RUNTIME_FAKE", "false").lower() == "true",
            profile_revision=os.getenv("SOKUJI_RUNTIME_PROFILE_REVISION", "runtime-unconfigured"),
            input_retention_days=_positive_int("SOKUJI_INPUT_RETENTION_DAYS", 7),
            result_retention_days=_positive_int("SOKUJI_RESULT_RETENTION_DAYS", 30),
            cleanup_interval_seconds=_positive_int("SOKUJI_CLEANUP_INTERVAL_SECONDS", 21600),
            moss_model_id=os.getenv("SOKUJI_MOSS_MODEL_ID", "OpenMOSS-Team/MOSS-Transcribe-Diarize"),
            moss_model_revision=os.getenv("SOKUJI_MOSS_MODEL_REVISION", "unconfigured"),
            moss_worker_url=os.getenv("SOKUJI_MOSS_WORKER_URL", ""),
            moss_worker_timeout_seconds=_positive_int("SOKUJI_MOSS_WORKER_TIMEOUT_SECONDS", 7200),
            moss_max_new_tokens=_positive_int("SOKUJI_MOSS_MAX_NEW_TOKENS", 65536),
            moss_validated_max_duration_sec=_non_negative_int("SOKUJI_MOSS_VALIDATED_MAX_DURATION_SEC", 0),
            funasr_model_id=os.getenv("SOKUJI_FUNASR_MODEL_ID", "FunAudioLLM/Fun-ASR-Nano-2512"),
            funasr_model_revision=os.getenv("SOKUJI_FUNASR_MODEL_REVISION", "unconfigured"),
            funasr_vad_model_id=os.getenv("SOKUJI_FUNASR_VAD_MODEL_ID", "fsmn-vad"),
            funasr_vad_model_revision=os.getenv("SOKUJI_FUNASR_VAD_MODEL_REVISION", "unconfigured"),
            funasr_speaker_model_id=os.getenv("SOKUJI_FUNASR_SPEAKER_MODEL_ID", "iic/speech_eres2netv2_sv_zh-cn_16k-common"),
            funasr_speaker_model_revision=os.getenv("SOKUJI_FUNASR_SPEAKER_MODEL_REVISION", "unconfigured"),
            funasr_worker_url=os.getenv("SOKUJI_FUNASR_WORKER_URL", ""),
            funasr_worker_timeout_seconds=_positive_int("SOKUJI_FUNASR_WORKER_TIMEOUT_SECONDS", 7200),
            funasr_vad_max_single_segment_time_ms=_positive_int("SOKUJI_FUNASR_VAD_MAX_SINGLE_SEGMENT_TIME_MS", 30000),
            funasr_gpu_memory_utilization=float(os.getenv("SOKUJI_FUNASR_GPU_MEMORY_UTILIZATION", "0.5")),
            funasr_validated_max_duration_sec=_non_negative_int("SOKUJI_FUNASR_VALIDATED_MAX_DURATION_SEC", 0),
            test_config_enabled=os.getenv("SOKUJI_TEST_CONFIG_ENABLED", "false").lower() == "true",
            test_config_username=os.getenv("SOKUJI_TEST_CONFIG_USERNAME", ""),
            test_config_password_hash=os.getenv("SOKUJI_TEST_CONFIG_PASSWORD_HASH", ""),
            test_config_file=Path(os.getenv("SOKUJI_TEST_CONFIG_FILE", "/var/lib/sokuji-recording-runtime/test-config.json")),
        )

    def speech_profile(self, engine: str) -> dict:
        if self.fake_runtime:
            return {"available": True, "id": "development-placeholder", "model": "development-placeholder", "revision": "fake-runtime-v1", "modelRevision": "fake-runtime-v1", "worker": "control-api-fake", "backend": "fake", "outputSchemaVersion": 1}
        if engine == "moss":
            return {"id": self.moss_model_id, "model": self.moss_model_id, "revision": self.moss_model_revision, "modelRevision": self.moss_model_revision, "worker": "moss-worker", "backend": "vllm", "validatedMaxDurationSec": self.moss_validated_max_duration_sec, "outputSchemaVersion": 1}
        if engine == "funasr-meeting":
            return {
                "id": self.funasr_model_id, "model": self.funasr_model_id, "revision": self.funasr_model_revision, "modelRevision": self.funasr_model_revision,
                "worker": "funasr-worker", "backend": "vllm",
                "vadModelId": self.funasr_vad_model_id, "vadModelRevision": self.funasr_vad_model_revision,
                "vadMaxSingleSegmentTimeMs": self.funasr_vad_max_single_segment_time_ms,
                "speakerModelId": self.funasr_speaker_model_id, "speakerModelRevision": self.funasr_speaker_model_revision,
                "speakerAttribution": "integrated", "validatedMaxDurationSec": self.funasr_validated_max_duration_sec, "outputSchemaVersion": 1,
            }
        raise ValueError(f"Unsupported speech engine: {engine}")

    def model_for(self, task_type: str, engine: str | None = None) -> dict:
        if task_type == "speech":
            return self.speech_profile(engine or "moss")
        return {"id": "unconfigured", "revision": "unconfigured", "worker": "unconfigured"}
