from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
from pathlib import Path
from threading import Lock

from ..config import settings

logger = logging.getLogger("andromeda_sales.audit")
_lock = Lock()


def record_event(*, actor: str, action: str, target: str, details: dict) -> None:
    """Write a structured marketing audit event without touching shared schema."""
    event = {
        "at": datetime.now(timezone.utc).isoformat(),
        "actor": actor,
        "action": action,
        "target": target,
        "details": details,
    }
    logger.info("audit_event %s", json.dumps(event, ensure_ascii=False, default=str))
    try:
        path = settings.data_dir / "audit.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with _lock, path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")
    except OSError:
        logger.exception("Unable to persist audit event")


def recent_events(limit: int = 100) -> list[dict]:
    path = settings.data_dir / "audit.jsonl"
    if not path.exists():
        return []
    with _lock:
        lines = path.read_text(encoding="utf-8").splitlines()
    result: list[dict] = []
    for line in reversed(lines[-limit:]):
        try:
            result.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return result
