"""Warehouses + per-warehouse stock (the "warehouse ostatok").

Mirrors ANDROMEDA's `warehouses` / `warehouse_stocks` tables exactly.
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, ForeignKey, Index, Numeric, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPKMixin

if TYPE_CHECKING:
    from .analytics import AnalyticsProduct
    from .project import Project


class Warehouse(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "warehouses"

    name: Mapped[str] = mapped_column(Text, nullable=False)
    code: Mapped[Optional[str]] = mapped_column(Text, unique=True, nullable=True, index=True)
    project_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    project: Mapped[Optional[str]] = mapped_column(Text, nullable=True, index=True)
    warehouse_type: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    city: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true"), index=True
    )

    project_rel: Mapped[Optional["Project"]] = relationship(
        "Project", back_populates="warehouses"
    )

    @property
    def project_name(self) -> Optional[str]:
        return self.project_rel.name if self.project_rel else self.project

    stocks: Mapped[list["WarehouseStock"]] = relationship(back_populates="warehouse")


class WarehouseStock(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "warehouse_stocks"

    warehouse_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("warehouses.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analytics_products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    quantity: Mapped[Decimal] = mapped_column(
        Numeric(14, 4), nullable=False, default=Decimal("0"), server_default="0"
    )

    __table_args__ = (
        UniqueConstraint(
            "product_id", "warehouse_id", name="warehouse_stocks_product_warehouse_unique"
        ),
        Index("idx_warehouse_stocks_wh_prod", "warehouse_id", "product_id"),
        Index("idx_warehouse_stocks_prod_wh", "product_id", "warehouse_id"),
    )

    warehouse: Mapped["Warehouse"] = relationship(back_populates="stocks")
    product: Mapped["AnalyticsProduct"] = relationship(back_populates="warehouse_stocks")
