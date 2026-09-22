"""Read-only certificate library backed by ANDROMEDA's shared tables."""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..config import settings
from ..db import get_db
from ..models import Certificate, CertificateProductLink
from ..storage import r2


router = APIRouter(prefix="/certificates", tags=["certificates"])
_LOAD = selectinload(Certificate.product_links).selectinload(CertificateProductLink.product)


class CertificateProductRead(BaseModel):
    product_id: Optional[UUID] = None
    catalog_name: str
    trade_name: str
    dosage_form: Optional[str] = None


class CertificateRead(BaseModel):
    id: UUID
    certificate_number: str
    registration_date: Optional[date] = None
    valid_until: Optional[date] = None
    trade_name: str
    dosage_form: Optional[str] = None
    holder_name: Optional[str] = None
    holder_country: Optional[str] = None
    manufacturer_name: Optional[str] = None
    manufacturer_country: Optional[str] = None
    api_details: Optional[str] = None
    authorized_person: Optional[str] = None
    notes: Optional[str] = None
    product_links: list[CertificateProductRead]
    document_name: Optional[str] = None
    document_size_bytes: Optional[int] = None
    document_mime_type: Optional[str] = None
    document_uploaded_at: Optional[datetime] = None


class CertificateUrl(BaseModel):
    url: str
    expires_in_seconds: int


def _read(item: Certificate) -> CertificateRead:
    links = [
        CertificateProductRead(
            product_id=link.product_id,
            catalog_name=link.product.name,
            trade_name=link.trade_name or item.trade_name,
            dosage_form=link.dosage_form or item.dosage_form,
        )
        for link in item.product_links
    ]
    if not links:
        links = [
            CertificateProductRead(
                product_id=None,
                catalog_name=item.trade_name,
                trade_name=item.trade_name,
                dosage_form=item.dosage_form,
            )
        ]
    return CertificateRead(
        id=item.id,
        certificate_number=item.certificate_number,
        registration_date=item.registration_date,
        valid_until=item.valid_until,
        trade_name=item.trade_name,
        dosage_form=item.dosage_form,
        holder_name=item.holder_name,
        holder_country=item.holder_country,
        manufacturer_name=item.manufacturer_name,
        manufacturer_country=item.manufacturer_country,
        api_details=item.api_details,
        authorized_person=item.authorized_person,
        notes=item.notes,
        product_links=links,
        document_name=item.document_name,
        document_size_bytes=item.document_size_bytes,
        document_mime_type=item.document_mime_type,
        document_uploaded_at=item.document_uploaded_at,
    )


@router.get("", response_model=list[CertificateRead])
def list_certificates(db: Session = Depends(get_db)) -> list[CertificateRead]:
    rows = db.scalars(
        select(Certificate)
        .options(_LOAD)
        .order_by(Certificate.valid_until.asc().nulls_last(), Certificate.trade_name)
    ).all()
    return [_read(row) for row in rows]


@router.get("/{certificate_id}/document-url", response_model=CertificateUrl)
def certificate_document_url(certificate_id: UUID, db: Session = Depends(get_db)) -> CertificateUrl:
    item = db.get(Certificate, certificate_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Certificate not found.")
    if not item.document_storage_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Certificate has no uploaded PDF.")
    try:
        url = r2.create_download_url(
            key=item.document_storage_path,
            ttl_seconds=settings.r2_presigned_ttl_seconds,
        )
    except r2.R2NotConfigured:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Certificate storage is not configured.")
    except Exception:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Certificate storage is temporarily unavailable.")
    return CertificateUrl(url=url, expires_in_seconds=settings.r2_presigned_ttl_seconds)
