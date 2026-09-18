"""Server-issued JWT auth, interoperable with ANDROMEDA.

Both apps share the `users` and `auth_sessions` tables and the same
AUTH_SECRET_KEY, so a session issued here is a first-class ANDROMEDA session
(and vice-versa). Roles: sysadmin ⊇ admin ⊇ guest. Guests are read-only.

This is a trimmed copy of ANDROMEDA's auth.py — same wire behaviour, without
the pieces this Sales app does not need.
"""
from __future__ import annotations

import time
from typing import Literal, Optional, TypedDict
from uuid import UUID, uuid4

import bcrypt
import jwt
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from .config import settings
from .db import SessionLocal
from .models import User

Role = Literal["sysadmin", "admin", "guest"]
ROLES: tuple[Role, ...] = ("sysadmin", "admin", "guest")
_SESSION_VALIDATION_CACHE_TTL_SECONDS = 60.0
_session_validation_cache: dict[str, float] = {}


class TokenPayload(TypedDict):
    sub: str      # username
    role: Role
    jti: str      # auth_sessions.id
    exp: int
    iat: int


class InvalidCredentials(Exception):
    """Wrong username or password (or account disabled)."""


class InvalidToken(Exception):
    """Signature / expiry / shape failure."""


Credentials = tuple[Role, str | None]


def _check_db(session: Session, username: str, password: str) -> Optional[Credentials]:
    user = session.scalar(select(User).where(User.username == username))
    if user is None or user.disabled:
        return None
    try:
        ok = bcrypt.checkpw(password.encode("utf-8"), user.password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return None
    if not ok:
        return None
    return user.role.value, str(user.id)  # type: ignore[return-value]


def verify_credentials(username: str, password: str) -> Credentials:
    """Match exclusively against enabled DB users (case-insensitive username)."""
    u = (username or "").strip().lower()
    try:
        with SessionLocal() as session:
            credentials = _check_db(session, u, password)
    except SQLAlchemyError:
        credentials = None
    if credentials is not None:
        return credentials
    raise InvalidCredentials("Unknown username or password.")


def record_login_event(
    *,
    username: str,
    success: bool,
    role: Role | None,
    ip: str | None,
    user_agent: str | None,
    failure_reason: str | None = None,
) -> None:
    """Record a login attempt in the shared login_events table (best-effort)."""
    try:
        with SessionLocal() as session:
            session.execute(
                text(
                    """
                    INSERT INTO login_events
                      (username, success, role, ip, user_agent, failure_reason, event_type)
                    VALUES
                      (:username, :success, :role, :ip, :user_agent, :failure_reason, 'login')
                    """
                ),
                {
                    "username": (username or "unknown").strip().lower()[:64],
                    "success": success,
                    "role": role,
                    "ip": ip[:64] if ip else None,
                    "user_agent": user_agent[:500] if user_agent else None,
                    "failure_reason": failure_reason[:120] if failure_reason else None,
                },
            )
            session.commit()
    except Exception:
        pass


def create_session_token(
    *,
    username: str,
    role: Role,
    user_id: str | None,
    ip: str | None,
    user_agent: str | None,
) -> tuple[str, int]:
    """Create a revocable server session row and sign its JWT.

    Unlike ANDROMEDA's login, this does NOT revoke the user's other active
    sessions — a Sales user may keep an ANDROMEDA tab open at the same time.
    """
    now = int(time.time())
    exp = now + settings.auth_token_ttl_seconds
    session_id = uuid4()
    with SessionLocal() as session:
        session.execute(
            text(
                """
                INSERT INTO auth_sessions
                  (id, user_id, username, role, issued_at, expires_at, ip, user_agent)
                VALUES
                  (:id, :user_id, :username, :role, to_timestamp(:issued_at),
                   to_timestamp(:expires_at), :ip, :user_agent)
                """
            ),
            {
                "id": session_id,
                "user_id": UUID(user_id) if user_id else None,
                "username": username,
                "role": role,
                "issued_at": now,
                "expires_at": exp,
                "ip": ip[:64] if ip else None,
                "user_agent": user_agent[:500] if user_agent else None,
            },
        )
        session.commit()
    payload: TokenPayload = {
        "sub": username,
        "role": role,
        "jti": str(session_id),
        "iat": now,
        "exp": exp,
    }
    token = jwt.encode(payload, settings.auth_secret_key, algorithm="HS256")
    return token, exp


def decode_token(token: str) -> TokenPayload:
    """Verify signature + expiry. Raises InvalidToken on any failure."""
    try:
        payload = jwt.decode(token, settings.auth_secret_key, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as exc:
        raise InvalidToken("Token expired.") from exc
    except jwt.InvalidTokenError as exc:
        raise InvalidToken(f"Invalid token: {exc}") from exc
    if payload.get("role") not in ROLES or not payload.get("sub") or not payload.get("jti"):
        raise InvalidToken("Token payload malformed.")
    return payload  # type: ignore[return-value]


def validate_session(payload: TokenPayload, *, use_cache: bool = True) -> None:
    """Reject revoked, expired, missing, disabled, or role-stale sessions."""
    try:
        session_id = UUID(payload["jti"])
    except (KeyError, TypeError, ValueError) as exc:
        raise InvalidToken("Session identifier malformed.") from exc
    cache_key = f"{session_id}:{payload.get('sub')}:{payload.get('role')}"
    now = time.monotonic()
    cached_until = _session_validation_cache.get(cache_key)
    if use_cache and cached_until is not None and cached_until > now:
        return
    with SessionLocal() as session:
        row = session.execute(
            text(
                """
                SELECT s.username, s.role, s.revoked_at,
                       (s.expires_at <= now()) AS expired,
                       s.user_id, u.disabled, u.role::text AS current_role
                FROM auth_sessions s
                LEFT JOIN users u ON u.id = s.user_id
                WHERE s.id = :session_id
                """
            ),
            {"session_id": session_id},
        ).mappings().one_or_none()
    if row is None or row["revoked_at"] is not None or row["expired"]:
        raise InvalidToken("Session expired or revoked.")
    if row["username"] != payload["sub"] or row["role"] != payload["role"]:
        raise InvalidToken("Session identity changed.")
    if row["user_id"] is None or row["disabled"] is True or row["current_role"] != payload["role"]:
        raise InvalidToken("Account access changed.")
    for key, expiry in list(_session_validation_cache.items()):
        if expiry <= now:
            _session_validation_cache.pop(key, None)
    if len(_session_validation_cache) >= 4096:
        _session_validation_cache.pop(next(iter(_session_validation_cache), None), None)
    _session_validation_cache[cache_key] = now + _SESSION_VALIDATION_CACHE_TTL_SECONDS


def revoke_session(session_id: str) -> None:
    """Revoke one session. Missing/already-revoked IDs are harmless."""
    try:
        parsed_id = UUID(session_id)
    except (TypeError, ValueError):
        return
    with SessionLocal() as session:
        session.execute(
            text(
                """
                UPDATE auth_sessions
                SET revoked_at = COALESCE(revoked_at, now())
                WHERE id = :session_id
                """
            ),
            {"session_id": parsed_id},
        )
        session.commit()
    prefix = f"{parsed_id}:"
    for key in list(_session_validation_cache):
        if key.startswith(prefix):
            _session_validation_cache.pop(key, None)


def is_write_method(method: str) -> bool:
    return method.upper() in ("POST", "PATCH", "PUT", "DELETE")


__all__ = [
    "InvalidCredentials",
    "InvalidToken",
    "Role",
    "ROLES",
    "TokenPayload",
    "create_session_token",
    "decode_token",
    "is_write_method",
    "record_login_event",
    "revoke_session",
    "validate_session",
    "verify_credentials",
]
