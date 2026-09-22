"""Read-only mappings for ANDROMEDA's certificate library tables."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPKMixin


class CertificateProductLink(Base):
    __tablename__ = "certificate_products"

    certificate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("certificates.id", ondelete="CASCADE"),
        primary_key=True,
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analytics_products.id", ondelete="CASCADE"),
        primary_key=True,
    )
    trade_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    dosage_form: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    certificate: Mapped["Certificate"] = relationship(back_populates="product_links")
    product: Mapped["AnalyticsProduct"] = relationship()


class Certificate(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "certificates"

    certificate_number: Mapped[str] = mapped_column(Text, unique=True)
    registration_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    valid_until: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    trade_name: Mapped[str] = mapped_column(Text)
    dosage_form: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    holder_supplier_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True
    )
    holder_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    holder_country: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    manufacturer_supplier_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True
    )
    manufacturer_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    manufacturer_country: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    api_details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    authorized_person: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    document_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    document_storage_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    document_size_bytes: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    document_mime_type: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    document_uploaded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    product_links: Mapped[list[CertificateProductLink]] = relationship(
        back_populates="certificate",
        order_by=CertificateProductLink.trade_name,
    )
