"""Analytics catalog + monthly fact tables + company-level stock.

These mirror ANDROMEDA's `analytics_*` tables exactly. This app reads them for
the Sales-department "ostatok" (stock/balance) and sales views.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Numeric, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPKMixin

if TYPE_CHECKING:
    from .warehouse import WarehouseStock
    from .project import Project


class AnalyticsProduct(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "analytics_products"

    name: Mapped[str] = mapped_column(Text, unique=True)
    external_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    product_group: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    project_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    manufacturer_label: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    manufacturer_supplier_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("suppliers.id", ondelete="SET NULL"),
        nullable=True,
    )
    has_real_id: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    strength: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    dosage_form: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    pack_weight: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 3), nullable=True)
    de_facto_cost: Mapped[Optional[Decimal]] = mapped_column(Numeric(14, 4), nullable=True)
    de_euro_cost: Mapped[Optional[Decimal]] = mapped_column(Numeric(14, 4), nullable=True)
    de_facto_currency: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    de_euro_currency: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    country: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    catalog_category: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    sales: Mapped[list["AnalyticsSales"]] = relationship(back_populates="product")
    fact_sales: Mapped[list["AnalyticsFactSales"]] = relationship(back_populates="product")
    orders: Mapped[list["AnalyticsOrders"]] = relationship(back_populates="product")
    received: Mapped[list["AnalyticsReceived"]] = relationship(back_populates="product")
    warehouse_stocks: Mapped[list["WarehouseStock"]] = relationship(back_populates="product")
    company_stock: Mapped[Optional["AnalyticsStockCompany"]] = relationship(
        back_populates="product", uselist=False
    )
    project_rel: Mapped[Optional["Project"]] = relationship(
        "Project", back_populates="products"
    )

    @property
    def project_name(self) -> Optional[str]:
        return self.project_rel.name if self.project_rel else self.product_group


class _MonthlyFact(UUIDPKMixin, TimestampMixin):
    month: Mapped[date] = mapped_column(Date)
    qty: Mapped[Decimal] = mapped_column(Numeric(14, 4))


class AnalyticsSales(_MonthlyFact, Base):
    __tablename__ = "analytics_sales"

    analytics_product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("analytics_products.id", ondelete="CASCADE")
    )
    product: Mapped["AnalyticsProduct"] = relationship(back_populates="sales")


class AnalyticsFactSales(_MonthlyFact, Base):
    __tablename__ = "analytics_fact_sales"

    analytics_product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("analytics_products.id", ondelete="CASCADE")
    )
    product: Mapped["AnalyticsProduct"] = relationship(back_populates="fact_sales")


class AnalyticsOrders(_MonthlyFact, Base):
    __tablename__ = "analytics_orders"

    analytics_product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("analytics_products.id", ondelete="CASCADE")
    )
    is_closed: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    manufacturer_label: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    file_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    storage_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    size_bytes: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    mime_type: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    uploaded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    product: Mapped["AnalyticsProduct"] = relationship(back_populates="orders")


class AnalyticsReceived(_MonthlyFact, Base):
    __tablename__ = "analytics_received"

    analytics_product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("analytics_products.id", ondelete="CASCADE")
    )
    cost: Mapped[Optional[Decimal]] = mapped_column(Numeric(14, 2), nullable=True)
    currency: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    manufacturer_label: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    product: Mapped["AnalyticsProduct"] = relationship(back_populates="received")


class AnalyticsStockCompany(UUIDPKMixin, TimestampMixin, Base):
    """Company-wide stock (the "company ostatok") — one qty per product."""

    __tablename__ = "analytics_stock_company"

    analytics_product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analytics_products.id", ondelete="CASCADE"),
        unique=True,
    )
    qty: Mapped[Decimal] = mapped_column(Numeric(14, 4))

    product: Mapped["AnalyticsProduct"] = relationship(back_populates="company_stock")
