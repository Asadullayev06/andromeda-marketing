"""Customs warehouse — the "customs ostatok", as a flat product-level list.

Each row is a single customs product line: name, expiry, quantity (with its
per-batch series), regime (IM-74 / TR-80 / INCOMING) and the parent invoice's
certificate status. A certificate PDF is served as a short-lived presigned R2
URL. Read-only.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from datetime import datetime, timezone
from uuid import UUID

from ..config import settings
from ..db import get_db
from ..models import (
    CustomsWarehouseClearance,
    CustomsWarehouseInvoice,
    CustomsWarehouseProduct,
    CustomsWarehouseSeries,
)
from ..services.audit import record_event
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
    rows = [
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
    # Drop depleted positions (qty 0) — they are not part of the customs stock.
    rows = [r for r in rows if r.qty > 0]
    # Incoming ("on the way") rows first, then customs-warehouse rows; each A→Z.
    items = sorted(
        rows,
        key=lambda i: (0 if i.regime.upper() == "INCOMING" else 1, i.product_name.lower()),
    )
    return CustomsProductList(
        items=items,
        total_invoices=len({i.invoice_id for i in items}),
        total_products=len(items),
        total_qty=sum(i.qty for i in items),
    )


class ClearedRow(BaseModel):
    id: str
    invoice_name: str
    product_name: str
    series_batch: Optional[str] = None
    regime: Optional[str] = None
    qty: float
    pallets: Optional[float] = None
    boxes: Optional[float] = None
    comment: Optional[str] = None
    cleared_at: datetime
    product_expiry: Optional[date] = None
    # 'customs' | 'transit' | 'company'; None falls back to the regime.
    warehouse_status: Optional[str] = None
    acknowledged: bool = False
    acknowledged_at: Optional[datetime] = None
    acknowledged_by: Optional[str] = None


class ClearedList(BaseModel):
    items: list[ClearedRow]
    total: int
    total_qty: float
    total_pallets: float
    total_boxes: float
    unacknowledged: int


def _cleared_row(r: CustomsWarehouseClearance, product_expiry: Optional[date] = None) -> ClearedRow:
    return ClearedRow(
        id=str(r.id),
        invoice_name=r.invoice_name,
        product_name=r.product_name,
        series_batch=r.series_batch,
        regime=r.regime,
        qty=float(r.qty),
        pallets=float(r.pallets) if r.pallets is not None else None,
        boxes=float(r.boxes) if r.boxes is not None else None,
        comment=r.comment,
        cleared_at=r.created_at,
        product_expiry=product_expiry,
        warehouse_status=r.warehouse_status,
        acknowledged=r.acknowledged_at is not None,
        acknowledged_at=r.acknowledged_at,
        acknowledged_by=r.acknowledged_by,
    )


@router.get("/cleared", response_model=ClearedList)
def list_cleared(
    db: Session = Depends(get_db),
    q: Optional[str] = Query(default=None),
    regime: Optional[str] = Query(default=None),
    view: str = Query(default="pending"),
) -> ClearedList:
    """Goods that have been cleared out of the customs warehouse (append-only
    ledger written by ANDROMEDA), newest first.

    `view`: 'pending' = not yet accepted (default, the main list), 'archived' =
    already accepted ("Qabul qilindi"), 'all' = both."""
    stmt = (
        select(CustomsWarehouseClearance, CustomsWarehouseProduct.product_expiry)
        .outerjoin(
            CustomsWarehouseProduct,
            CustomsWarehouseClearance.product_id == CustomsWarehouseProduct.id,
        )
        .order_by(CustomsWarehouseClearance.created_at.desc())
    )
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            CustomsWarehouseClearance.product_name.ilike(like)
            | CustomsWarehouseClearance.invoice_name.ilike(like)
            | CustomsWarehouseClearance.series_batch.ilike(like)
        )
    if regime:
        stmt = stmt.where(CustomsWarehouseClearance.regime == regime)
    if view == "pending":
        stmt = stmt.where(CustomsWarehouseClearance.acknowledged_at.is_(None))
    elif view == "archived":
        stmt = stmt.where(CustomsWarehouseClearance.acknowledged_at.is_not(None))
    rows = db.execute(stmt).all()
    items = [_cleared_row(r[0], product_expiry=r[1]) for r in rows]
    return ClearedList(
        items=items,
        total=len(items),
        total_qty=sum(i.qty for i in items),
        total_pallets=sum(i.pallets or 0 for i in items),
        total_boxes=sum(i.boxes or 0 for i in items),
        unacknowledged=sum(1 for i in items if not i.acknowledged),
    )


# ── Admin-only mutations on the cleared ledger ───────────────────────────────
# These write to the shared customs_warehouse_clearances table (created by
# ANDROMEDA). Restricted to admin/sysadmin and audited.
CLEARED_STATUSES = {"customs", "transit", "company"}


def _require_admin(request: Request) -> str:
    if getattr(request.state, "user_role", None) not in ("admin", "sysadmin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Administrator access required.")
    return getattr(request.state, "user_name", "admin")


class ClearedStatusInput(BaseModel):
    status: str


@router.patch("/cleared/{clearance_id}/status", response_model=ClearedRow)
def set_cleared_status(clearance_id: UUID, payload: ClearedStatusInput, request: Request, db: Session = Depends(get_db)) -> ClearedRow:
    actor = _require_admin(request)
    if payload.status not in CLEARED_STATUSES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid status.")
    row = db.get(CustomsWarehouseClearance, clearance_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clearance not found.")
    row.warehouse_status = payload.status
    db.commit()
    db.refresh(row)
    record_event(actor=actor, action="clearance_status_changed", target=str(row.id), details={"status": payload.status, "product": row.product_name})
    return _cleared_row(row)


class UnacknowledgedCount(BaseModel):
    count: int


@router.get("/cleared/unacknowledged-count", response_model=UnacknowledgedCount)
def cleared_unacknowledged_count(db: Session = Depends(get_db)) -> UnacknowledgedCount:
    """Cheap count for the sidebar badge — clearances not yet accepted."""
    n = db.scalar(
        select(func.count())
        .select_from(CustomsWarehouseClearance)
        .where(CustomsWarehouseClearance.acknowledged_at.is_(None))
    )
    return UnacknowledgedCount(count=int(n or 0))


@router.post("/cleared/{clearance_id}/acknowledge", response_model=ClearedRow)
def acknowledge_cleared(clearance_id: UUID, request: Request, db: Session = Depends(get_db)) -> ClearedRow:
    """Accept a single cleared line ("Qabul qilindi"). It then moves to the
    archived view and out of the pending list.

    Open to any signed-in user (guests included) — accepting is a low-risk
    acknowledgement. The read-only guest gate is bypassed for this path in
    main.py's GUEST_WRITABLE_PATHS.
    """
    actor = getattr(request.state, "user_name", "user")
    row = db.get(CustomsWarehouseClearance, clearance_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clearance not found.")
    if row.acknowledged_at is None:
        row.acknowledged_at = datetime.now(timezone.utc)
        row.acknowledged_by = actor
        db.commit()
        db.refresh(row)
        record_event(actor=actor, action="clearance_acknowledged", target=str(row.id), details={"product": row.product_name})
    return _cleared_row(row)


@router.delete("/cleared/{clearance_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cleared(clearance_id: UUID, request: Request, db: Session = Depends(get_db)) -> Response:
    actor = _require_admin(request)
    row = db.get(CustomsWarehouseClearance, clearance_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clearance not found.")
    product = row.product_name
    db.delete(row)
    db.commit()
    record_event(actor=actor, action="clearance_deleted", target=str(clearance_id), details={"product": product})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
