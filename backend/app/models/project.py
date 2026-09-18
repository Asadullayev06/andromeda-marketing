"""Canonical projects (product groups). Shared ANDROMEDA table — read-only here."""
from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPKMixin

if TYPE_CHECKING:
    from .analytics import AnalyticsProduct
    from .warehouse import Warehouse


class Project(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "projects"

    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False, index=True)
    code: Mapped[Optional[str]] = mapped_column(Text, unique=True, nullable=True, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true"), index=True
    )

    products: Mapped[list["AnalyticsProduct"]] = relationship(
        "AnalyticsProduct", back_populates="project_rel"
    )
    warehouses: Mapped[list["Warehouse"]] = relationship(
        "Warehouse", back_populates="project_rel"
    )
