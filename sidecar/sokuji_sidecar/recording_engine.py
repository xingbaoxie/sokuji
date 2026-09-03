"""Authenticated control seam for batch-recording work.

The Electron renderer never receives the token. Electron Main creates a second
localhost WebSocket for these messages, while real-time ASR keeps its existing
renderer-owned socket protocol unchanged.
"""

import hmac


def _authorize(state, message):
    expected = state.get("recording_token", "")
    supplied = message.get("token", "")
    return bool(expected and isinstance(supplied, str) and hmac.compare_digest(expected, supplied))


async def _status(state, message, _binary, _conn=None):
    if not _authorize(state, message):
        return {"type": "error", "id": message.get("id"), "message": "recording control is unauthorized"}, None
    configured = bool(state.get("recording_runtime_configured"))
    return {
        "type": "recording_status_result",
        "id": message.get("id"),
        "available": configured,
        "message": "runtime configured" if configured else "runtime code installed; no model runtime configured",
    }, None


def register(state):
    state.setdefault("handlers", {}).update({"recording_status": _status})
