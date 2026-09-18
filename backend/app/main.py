"""FastAPI entrypoint for the ANDROMEDA Sales (marketing_control) backend.

Middleware order matters: CORSMiddleware is added LAST so it wraps the auth
gate and is therefore OUTERMOST. Otherwise 401/403/500 responses come back
without Access-Control-Allow-Origin and the browser reports the misleading
"Failed to fetch" instead of the real status. (Same rule as ANDROMEDA.)

This service NEVER runs Alembic migrations — ANDROMEDA owns the schema.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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
    "/auth/login",
    "/docs",
    "/redoc",
    "/openapi.json",
}


@app.on_event("startup")
def _validate_security() -> None:
    settings.validate_runtime_security()


async def auth_gate(request: Request, call_next):
    """Require a valid, non-revoked session on every non-public endpoint and
    enforce the read-only guest gate on write methods."""
    path = request.url.path
    if request.method == "OPTIONS" or path in PUBLIC_PATHS:
        return await call_next(request)

    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return JSONResponse({"detail": "Not authenticated."}, status_code=401)
    token = header[7:].strip()
    try:
        payload = decode_token(token)
        validate_session(payload)
    except InvalidToken as exc:
        return JSONResponse({"detail": str(exc)}, status_code=401)

    role = payload["role"]
    if role not in ROLES:
        return JSONResponse({"detail": "Unknown role."}, status_code=403)
    # Guests are read-only across the whole app.
    if is_write_method(request.method) and role == "guest":
        return JSONResponse(
            {"detail": "Read-only account: writes are not permitted."},
            status_code=403,
        )

    request.state.user_name = payload["sub"]
    request.state.user_role = role
    request.state.session_id = payload["jti"]
    return await call_next(request)


app.add_middleware(BaseHTTPMiddleware, dispatch=auth_gate)

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
)

for module in (
    auth_router,
    catalog_router,
    company_stock_router,
    warehouses_router,
    customs_router,
    sales_router,
):
    app.include_router(module.router)
