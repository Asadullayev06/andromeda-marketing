"""Customs warehouse invoices/products/series (the "customs ostatok").

Mirrors ANDROMEDA's `customs_warehouse_*` tables. The certificate PDF metadata
columns exist on the invoice but are not surfaced by this Sales app.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import Date, ForeignKey, Numeric, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship  # noqa: F401

from .base import Base, TimestampMixin, UUIDPKMixin


class CustomsWarehouseInvoice(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "customs_warehouse_invoices"

    name: Mapped[str] = mapped_column(Text)
    supplier_label: Mapped[str] = mapped_column(Text, server_default="")
    regime_expiry: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    invoice_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2), server_default="0")
    invoice_currency: Mapped[str] = mapped_column(Text, server_default="USD")
    logistic_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2), server_default="0")
    currency: Mapped[str] = mapped_column(Text, server_default="USD")
    certificate_status: Mapped[str] = mapped_column(Text, server_default="not_available")
    certificate_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    certificate_storage_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    certificate_mime_type: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    products: Mapped[list["CustomsWarehouseProduct"]] = relationship(
        back_populates="invoice",
        order_by="CustomsWarehouseProduct.position",
    )


class CustomsWarehouseProduct(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "customs_warehouse_products"

    invoice_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("customs_warehouse_invoices.id", ondelete="CASCADE"),
    )
    position: Mapped[int] = mapped_column(server_default="0")
    product_name: Mapped[str] = mapped_column(Text)
    regime: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(Text)
    qty: Mapped[Decimal] = mapped_column(Numeric(14, 4), server_default="0")
    invoice_sum: Mapped[Decimal] = mapped_column(Numeric(14, 2), server_default="0")
    currency: Mapped[str] = mapped_column(Text, server_default="USD")
    product_expiry: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    brutto_kg: Mapped[Optional[Decimal]] = mapped_column(Numeric(14, 3), nullable=True)
    netto_kg: Mapped[Optional[Decimal]] = mapped_column(Numeric(14, 3), nullable=True)

    invoice: Mapped[CustomsWarehouseInvoice] = relationship(back_populates="products")
    series: Mapped[list["CustomsWarehouseSeries"]] = relationship(
        back_populates="product",
        order_by="CustomsWarehouseSeries.position",
    )


class CustomsWarehouseSeries(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "customs_warehouse_series"

    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("customs_warehouse_products.id", ondelete="CASCADE"),
    )
    position: Mapped[int] = mapped_column(server_default="0")
    batch: Mapped[str] = mapped_column(Text)
    qty: Mapped[Decimal] = mapped_column(Numeric(14, 4), server_default="0")

    product: Mapped[CustomsWarehouseProduct] = relationship(back_populates="series")
