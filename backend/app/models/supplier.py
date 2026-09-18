"""Suppliers directory — shared ANDROMEDA table (read-only here).

Only the columns this app needs. `supplier_kind = Manufacturer` rows are the
canonical manufacturer list used by Sales filters.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import Text
from sqlalchemy.orm import Mapped, mapped_column

from ..enums import SupplierKind
from .base import Base, TimestampMixin, UUIDPKMixin, pg_enum


class Supplier(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "suppliers"

    name: Mapped[str] = mapped_column(Text, unique=True)
    country: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    supplier_kind: Mapped[SupplierKind] = mapped_column(
        pg_enum(SupplierKind, "supplier_kind"),
        server_default=SupplierKind.Manufacturer.value,
    )
