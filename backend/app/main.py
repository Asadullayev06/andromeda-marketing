"""FastAPI entrypoint for the ANDROMEDA Sales (marketing_control) backend.

Middleware order matters: CORSMiddleware is added LAST so it wraps the auth
gate and is therefore OUTERMOST. Otherwise 401/403/500 responses come back
without Access-Control-Allow-Origin and the browser reports the misleading
"Failed to fetch" instead of the real status. (Same rule as ANDROMEDA.)

This service never runs Alembic migrations on ANDROMEDA tables. It creates a
separate marketing-owned conformity certificate table when permitted.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.middleware.base import BaseHTTPMiddleware

from .auth import (
    InvalidToken,
    ROLES,
    decode_token,
    is_write_method,
    validate_session,
)
from .config import settings
from .db import engine

logger = logging.getLogger("andromeda_sales")

app = FastAPI(title="ANDROMEDA Sales API", version="0.1.0")

# Endpoints reachable without a bearer token.
PUBLIC_PATHS = {
    "/",
    "/health",
    "/debug/status",
    "/auth/login",
    "/docs",
    "/redoc",
    "/openapi.json",
}


@app.get("/debug/status")
def debug_status() -> dict:
    """Diagnostic: which container + which database is answering this request.
    Refresh a few times — if `host`/`pid`/`db` change between requests, more
    than one backend (or database) is serving this domain, which is why writes
    and reads disagree. No secrets are returned (credentials are stripped)."""
    import os
    import socket
    from urllib.parse import urlsplit

    from sqlalchemy import func, select

    from .db import SessionLocal
    from .models import ConformityCertificate

    parts = urlsplit(settings.database_url)
    db_target = f"{parts.hostname or '?'}:{parts.port or '?'}{parts.path or ''}"
    try:
        with SessionLocal() as session:
            count = session.scalar(select(func.count()).select_from(ConformityCertificate))
    except Exception as exc:  # pragma: no cover - diagnostic only
        count = f"error: {type(exc).__name__}"
    return {
        "host": socket.gethostname(),
        "pid": os.getpid(),
        "db": db_target,
        "conformity_count": count,
    }


@app.on_event("startup")
def _validate_security() -> None:
    settings.validate_runtime_security()
    # This table belongs to marketing-control, separate from ANDROMEDA's schema.
    from .models import ConformityCertificate
    try:
        ConformityCertificate.__table__.create(bind=engine, checkfirst=True)
    except SQLAlchemyError:
        logger.exception("Could not prepare the marketing conformity certificate table")


async def auth_gate(request: Request, call_next):
    """Require a valid, non-revoked session on every non-public endpoint and
    enforce the read-only guest gate on write methods."""
    path = request.url.path
    if request.method == "OPTIONS" or path in PUBLIC_PATHS:
        response = await call_next(request)
        if path == "/auth/login":
            response.headers["Cache-Control"] = "no-store"
        return response

    header = request.headers.get("authorization", "")
    token = header[7:].strip() if header.lower().startswith("bearer ") else request.cookies.get(settings.auth_cookie_name, "")
    if not token:
        return JSONResponse({"detail": "Not authenticated."}, status_code=401, headers={"Cache-Control": "no-store"})
    try:
        payload = decode_token(token)
        validate_session(payload)
    except InvalidToken as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401, headers={"Cache-Control": "no-store"})

    role = payload["role"]
    if role not in ROLES:
        return JSONResponse({"detail": "Unknown role."}, status_code=403, headers={"Cache-Control": "no-store"})
    # Guests are read-only across the whole app.
    if is_write_method(request.method) and role == "guest":
        return JSONResponse(
            {"detail": "Read-only account: writes are not permitted."},
            status_code=403,
            headers={"Cache-Control": "no-store"},
        )

    request.state.user_name = payload["sub"]
    request.state.user_role = role
    request.state.session_id = payload["jti"]
    response = await call_next(request)
    response.headers["Cache-Control"] = "private, no-store"
    return response


app.add_middleware(BaseHTTPMiddleware, dispatch=auth_gate)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# CORS added LAST → outermost. Do not reorder.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "andromeda-sales", "status": "ok"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
def ready() -> dict[str, str]:
    from sqlalchemy import text

    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ready"}


# ── Routers ──────────────────────────────────────────────────────────────
from .api import (  # noqa: E402
    auth as auth_router,
    catalog as catalog_router,
    company_stock as company_stock_router,
    warehouses as warehouses_router,
    customs as customs_router,
    sales as sales_router,
    certificates as certificates_router,
    operations as operations_router,
    orders as orders_router,
    conformity_certificates as conformity_certificates_router,
)

for module in (
    auth_router,
    catalog_router,
    company_stock_router,
    warehouses_router,
    customs_router,
    sales_router,
    certificates_router,
    operations_router,
    orders_router,
    conformity_certificates_router,
):
    app.include_router(module.router)
