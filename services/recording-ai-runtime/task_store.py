import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Any


class TaskStore:
    """Small durable task store. Model workers never receive this connection."""

    def __init__(self, database_path: Path):
        database_path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(database_path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._lock = Lock()
        with self._connection:
            self._connection.execute("""
                CREATE TABLE IF NOT EXISTS runtime_tasks (
                  task_id TEXT PRIMARY KEY, task_type TEXT NOT NULL, status TEXT NOT NULL,
                  payload_json TEXT NOT NULL, result_json TEXT, error_code TEXT,
                  error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                  profile_revision TEXT, model_json TEXT, input_path TEXT,
                  input_sha256 TEXT, input_expires_at TEXT, cleanup_after TEXT,
                  engine TEXT, backend TEXT, runtime_profile_revision TEXT,
                  output_schema_version INTEGER
                )
            """)
            columns = {row[1] for row in self._connection.execute("PRAGMA table_info(runtime_tasks)")}
            for column, definition in {
                "profile_revision": "TEXT",
                "model_json": "TEXT",
                "input_path": "TEXT",
                "input_sha256": "TEXT",
                "input_expires_at": "TEXT",
                "cleanup_after": "TEXT",
                "engine": "TEXT",
                "backend": "TEXT",
                "runtime_profile_revision": "TEXT",
                "output_schema_version": "INTEGER",
            }.items():
                if column not in columns:
                    self._connection.execute(f"ALTER TABLE runtime_tasks ADD COLUMN {column} {definition}")

    def create(self, task: dict[str, Any]) -> None:
        payload = task["payload"]
        with self._lock, self._connection:
            self._connection.execute(
                """INSERT INTO runtime_tasks (
                    task_id, task_type, status, payload_json, result_json, error_code,
                    error_message, created_at, updated_at, profile_revision, model_json,
                    input_path, input_sha256, input_expires_at, cleanup_after,
                    engine, backend, runtime_profile_revision, output_schema_version
                ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    task["taskId"], task["type"], task["status"], json.dumps(payload), task["createdAt"], task["updatedAt"],
                    payload.get("profileRevision"), json.dumps(task.get("model", {})), payload.get("inputPath"),
                    payload.get("sha256"), task.get("inputExpiresAt"), task.get("cleanupAfter"),
                    payload.get("engine"), task.get("model", {}).get("backend"), payload.get("profileRevision"), 1,
                ),
            )

    def get(self, task_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._connection.execute("SELECT * FROM runtime_tasks WHERE task_id = ?", (task_id,)).fetchone()
        if row is None:
            return None
        return {
            "taskId": row["task_id"], "type": row["task_type"], "status": row["status"],
            "payload": json.loads(row["payload_json"]), "result": json.loads(row["result_json"]) if row["result_json"] else None,
            "error": {"code": row["error_code"], "message": row["error_message"]} if row["error_code"] else None,
            "createdAt": row["created_at"], "updatedAt": row["updated_at"],
            "profileRevision": row["profile_revision"],
            "model": json.loads(row["model_json"] or "{}"),
            "engine": row["engine"], "backend": row["backend"],
            "runtimeProfileRevision": row["runtime_profile_revision"],
            "outputSchemaVersion": row["output_schema_version"],
            "inputExpiresAt": row["input_expires_at"], "cleanupAfter": row["cleanup_after"],
        }

    def update(self, task_id: str, *, status: str, updated_at: str, result: dict[str, Any] | None = None,
               error: tuple[str, str] | None = None) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "UPDATE runtime_tasks SET status=?, result_json=?, error_code=?, error_message=?, updated_at=? WHERE task_id=?",
                (status, json.dumps(result) if result is not None else None, error[0] if error else None,
                 error[1] if error else None, updated_at, task_id),
            )

    def fail_interrupted_tasks(self, updated_at: str) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "UPDATE runtime_tasks SET status='failed', error_code='RUNTIME_RESTARTED', error_message='Runtime restarted while task was active', updated_at=? WHERE status IN ('queued', 'running', 'cancelling')",
                (updated_at,),
            )

    def cleanup_expired(self, *, input_directory: Path, now: datetime | None = None) -> dict[str, int]:
        """Delete expired uploads first, then delete records/results at their retention deadline."""
        timestamp = (now or datetime.now(UTC)).astimezone(UTC)
        now_value = timestamp.isoformat()
        deleted_inputs = 0
        deleted_tasks = 0
        safe_input_directory = input_directory.resolve()
        with self._lock, self._connection:
            expired_inputs = self._connection.execute(
                "SELECT task_id, payload_json, input_path FROM runtime_tasks WHERE input_path IS NOT NULL AND input_expires_at <= ?",
                (now_value,),
            ).fetchall()
            for row in expired_inputs:
                input_path = Path(row["input_path"])
                try:
                    if input_path.resolve().is_relative_to(safe_input_directory):
                        input_path.unlink(missing_ok=True)
                        deleted_inputs += 1
                except (OSError, ValueError):
                    # Retention continues for other tasks; the missing source is not retried endlessly.
                    pass
                payload = json.loads(row["payload_json"])
                payload.pop("inputPath", None)
                payload["inputExpiredAt"] = now_value
                self._connection.execute(
                    "UPDATE runtime_tasks SET payload_json=?, input_path=NULL, updated_at=? WHERE task_id=?",
                    (json.dumps(payload), now_value, row["task_id"]),
                )
            cursor = self._connection.execute("DELETE FROM runtime_tasks WHERE cleanup_after <= ?", (now_value,))
            deleted_tasks = cursor.rowcount
        return {"deletedInputs": deleted_inputs, "deletedTasks": deleted_tasks}


def retention_deadlines(created_at: str, input_retention_days: int, result_retention_days: int) -> tuple[str, str]:
    created = datetime.fromisoformat(created_at).astimezone(UTC)
    return (
        (created + timedelta(days=input_retention_days)).isoformat(),
        (created + timedelta(days=result_retention_days)).isoformat(),
    )
