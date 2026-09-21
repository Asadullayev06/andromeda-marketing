"""Customs warehouse — the "customs ostatok", as a flat product-level list.

Each row is a single customs product line: name, expiry, quantity (with its
per-batch series), regime (IM-74 / TR-80 / INCOMING) and the parent invoice's
certificate status. A certificate PDF is served as a short-lived presigned R2
URL. Read-only.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..config import settings
from ..db import get_db
from ..models import (
    CustomsWarehouseInvoice,
    CustomsWarehouseProduct,
    CustomsWarehouseSeries,
)
from ..storage import r2

router = APIRouter(prefix="/customs", tags=["customs"])


class SeriesRow(BaseModel):
    id: str
    batch: str
    qty: float


class CustomsProductRow(BaseModel):
    id: str
    invoice_id: str
    product_name: str
    regime: str
    category: str
    qty: float
    product_expiry: Optional[date] = None
    certificate_status: str
    has_certificate: bool
    series: list[SeriesRow]


class CustomsProductList(BaseModel):
    items: list[CustomsProductRow]
    total_invoices: int
    total_products: int
    total_qty: float


@router.get("/products", response_model=CustomsProductList)
def list_customs_products(
    db: Session = Depends(get_db),
    q: Optional[str] = Query(default=None),
    regime: Optional[str] = Query(default=None),
) -> CustomsProductList:
    stmt = (
        select(CustomsWarehouseProduct)
        .join(CustomsWarehouseInvoice, CustomsWarehouseInvoice.id == CustomsWarehouseProduct.invoice_id)
        .options(
            selectinload(CustomsWarehouseProduct.series),
            selectinload(CustomsWarehouseProduct.invoice),
        )
        .order_by(CustomsWarehouseProduct.product_name)
    )
    if q:
        stmt = stmt.where(CustomsWarehouseProduct.product_name.ilike(f"%{q.strip()}%"))
    if regime:
        stmt = stmt.where(CustomsWarehouseProduct.regime == regime)

    products = db.scalars(stmt).all()
    items = [
        CustomsProductRow(
            id=str(p.id),
            invoice_id=str(p.invoice_id),
            product_name=p.product_name,
            regime=p.regime,
            category=p.category,
            qty=float(p.qty),
            product_expiry=p.product_expiry,
            certificate_status=p.invoice.certificate_status if p.invoice else "not_available",
            has_certificate=bool(p.invoice and p.invoice.certificate_storage_path),
            series=[SeriesRow(id=str(s.id), batch=s.batch, qty=float(s.qty)) for s in p.series],
        )
        for p in products
    ]
    return CustomsProductList(
        items=items,
        total_invoices=len({p.invoice_id for p in products}),
        total_products=len(items),
        total_qty=sum(i.qty for i in items),
    )


class CertificateUrl(BaseModel):
    url: str
    expires_in_seconds: int


@router.get("/invoices/{invoice_id}/certificate-url", response_model=CertificateUrl)
def get_certificate_url(invoice_id: str, db: Session = Depends(get_db)) -> CertificateUrl:
    invoice = db.get(CustomsWarehouseInvoice, invoice_id)
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found.")
    if not invoice.certificate_storage_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice has no uploaded certificate.")
    try:
        url = r2.create_download_url(
            key=invoice.certificate_storage_path,
            ttl_seconds=settings.r2_presigned_ttl_seconds,
        )
    except r2.R2NotConfigured:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Certificate storage is not configured.")
    except Exception:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Certificate storage is temporarily unavailable.")
    return CertificateUrl(url=url, expires_in_seconds=settings.r2_presigned_ttl_seconds)
