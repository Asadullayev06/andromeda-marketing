"""User accounts — the SHARED ANDROMEDA roster (read-only in this app).

We only ever read this table here (login verification, display name, role).
Account management stays in ANDROMEDA's System Admin.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import Boolean, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..enums import UserRole
from .base import Base, TimestampMixin, UUIDPKMixin, pg_enum


class User(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[UserRole] = mapped_column(
        pg_enum(UserRole, name="user_role"), nullable=False
    )
    disabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_technical: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    display_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    department: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    position: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    avatar_storage_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    preferences: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
