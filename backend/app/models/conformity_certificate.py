"""Marketing-owned certificate of conformity records and official PDFs."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, LargeBinary, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, deferred

from .base import Base


class ConformityCertificate(Base):
    __tablename__ = "marketing_conformity_certificates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    certificate_number: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    registration_date: Mapped[date] = mapped_column(Date, nullable=False)
    valid_until: Mapped[date] = mapped_column(Date, nullable=False)
    applicant: Mapped[str] = mapped_column(Text, nullable=False)
    manufacturer: Mapped[str] = mapped_column(Text, nullable=False)
    certifying_body: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    product_lines: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, default=list)
    document_name: Mapped[str] = mapped_column(Text, nullable=False)
    document_mime_type: Mapped[str] = mapped_column(String(100), nullable=False, default="application/pdf")
    document_size_bytes: Mapped[int] = mapped_column(nullable=False)
    document_blob: Mapped[bytes] = deferred(mapped_column(LargeBinary, nullable=False))
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
