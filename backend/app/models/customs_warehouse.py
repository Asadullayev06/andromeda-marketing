"""Customs warehouse invoices/products/series (the "customs ostatok").

Mirrors ANDROMEDA's `customs_warehouse_*` tables. The certificate PDF metadata
columns exist on the invoice but are not surfaced by this Sales app.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Numeric, Text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
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


class CustomsWarehouseClearance(UUIDPKMixin, TimestampMixin, Base):
    """Cleared customs goods (goods that left the customs warehouse).

    Written by ANDROMEDA on each clearance; read-only here. Descriptive fields
    are snapshots, so this survives edits/deletes of the source rows.
    """

    __tablename__ = "customs_warehouse_clearances"

    invoice_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    product_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    series_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    invoice_name: Mapped[str] = mapped_column(Text)
    product_name: Mapped[str] = mapped_column(Text)
    series_batch: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    regime: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    category: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    currency: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    qty: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    pallets: Mapped[Optional[Decimal]] = mapped_column(Numeric(14, 3), nullable=True)
    boxes: Mapped[Optional[Decimal]] = mapped_column(Numeric(14, 3), nullable=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Admin-editable logistics status (NULL -> derived from regime) and
    # "Qabul qilindi" acceptance tracking. Columns added by ANDROMEDA
    # migration 0099; written here by the Sales admin actions.
    warehouse_status: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_by: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class CustomsWarehouseClearanceDocument(UUIDPKMixin, TimestampMixin, Base):
    """Read-only view of documents owned by ANDROMEDA's clearance ledger."""

    __tablename__ = "customs_warehouse_clearance_documents"

    clearance_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    file_name: Mapped[str] = mapped_column(Text)
    storage_path: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    mime_type: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    recipient_user_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)))
