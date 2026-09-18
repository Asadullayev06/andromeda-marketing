"""Application settings for the ANDROMEDA Sales (marketing_control) backend.

This service is a SECOND, read/write frontend onto the SAME shared PostgreSQL
database that powers ANDROMEDA (custom_control). It deliberately does NOT own
the schema: it never runs Alembic migrations. ANDROMEDA remains the single
owner of migrations; this app only reads and writes existing tables.

Login interoperates with ANDROMEDA because both services share:
  * the same `users` / `auth_sessions` tables (same DATABASE_URL), and
  * the same JWT signing secret (AUTH_SECRET_KEY).

The raw connection URL and secret are never logged or returned by any endpoint.
"""
from __future__ import annotations

import os
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Accept either NEON_DATABASE_URL or DATABASE_URL — same as ANDROMEDA, so a
    # single connection string can be copied across both backends unchanged.
    neon_database_url: str = Field(
        default="",
        validation_alias=AliasChoices("NEON_DATABASE_URL", "DATABASE_URL"),
    )

    cors_origins: str = "http://localhost:5175,http://localhost:5173"
    env: str = "development"

    # Connection pool. Kept small: this is a read-mostly reporting surface that
    # shares the production database with ANDROMEDA. Do not over-provision.
    database_pool_size: int = Field(default=5, ge=1, le=50)
    database_max_overflow: int = Field(default=5, ge=0, le=100)
    database_pool_timeout_seconds: int = Field(default=30, ge=1, le=60)
    database_pool_recycle_seconds: int = Field(default=300, ge=30, le=3600)
    database_statement_timeout_ms: int = Field(default=30_000, ge=1_000, le=300_000)

    # ── Auth ─────────────────────────────────────────────────────────────
    # MUST equal ANDROMEDA's AUTH_SECRET_KEY so the shared user roster and
    # sessions are interoperable. Dev default matches ANDROMEDA's dev default
    # so local development against a shared local DB works out of the box.
    auth_secret_key: str = "dev-secret-change-me-in-production"
    auth_token_ttl_seconds: int = 60 * 60 * 12  # 12h

    def __init__(self, **values: object) -> None:
        super().__init__(**values)
        if not self.neon_database_url:
            # Fall back to a raw env read so a bare DATABASE_URL in the process
            # environment (Coolify / Railway) is picked up even without .env.
            self.neon_database_url = (
                os.environ.get("NEON_DATABASE_URL")
                or os.environ.get("DATABASE_URL")
                or ""
            ).strip()

    @property
    def database_url(self) -> str:
        """SQLAlchemy URL, normalized to the psycopg3 driver."""
        url = self.neon_database_url
        if url.startswith("postgresql://"):
            return "postgresql+psycopg://" + url[len("postgresql://") :]
        if url.startswith("postgres://"):
            return "postgresql+psycopg://" + url[len("postgres://") :]
        return url

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def validate_runtime_security(self) -> None:
        """Refuse an unsafe production boot instead of serving with dev secrets."""
        if self.env.strip().lower() != "production":
            return
        problems: list[str] = []
        if self.auth_secret_key == "dev-secret-change-me-in-production" or len(self.auth_secret_key) < 32:
            problems.append("AUTH_SECRET_KEY must be a unique value of at least 32 characters")
        if not self.database_url:
            problems.append("DATABASE_URL or NEON_DATABASE_URL must be configured")
        if problems:
            raise RuntimeError("Unsafe production configuration: " + "; ".join(problems) + ".")


settings = Settings()
