"""Customs warehouse — the "customs ostatok", as a flat product-level list.

Each row is a single customs product line: name, expiry, quantity (with its
per-batch series), regime (IM-74 / TR-80 / INCOMING) and the parent invoice's
certificate status. A certificate PDF is served as a short-lived presigned R2
URL. Read-only.
"""
from __future__ import annotations

import io
import json
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, not_, or_, select
from sqlalchemy.orm import Session, selectinload

from datetime import datetime, timezone
from uuid import UUID, uuid4

from ..config import settings
from ..db import get_db
from ..models import (
    AnalyticsProduct,
    CustomsWarehouseClearance,
    CustomsWarehouseClearanceDocument,
    CustomsWarehouseInvoice,
    CustomsWarehouseProduct,
    CustomsWarehouseSeries,
    User,
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


class ClearedDocument(BaseModel):
    id: str
    file_name: str
    document_type: Optional[str] = None
    size_bytes: int


class ClearedRow(BaseModel):
    id: str
    invoice_name: str
    product_name: str
    manufacturer: Optional[str] = None
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
    documents: list[ClearedDocument] = Field(default_factory=list)
    # ND-40 goods enter the company warehouse but may not be sold until a
    # certificate is released. `no_sale_permission` flags that state.
    no_sale_permission: bool = False
    sale_released: bool = False
    sale_released_at: Optional[datetime] = None
    sale_released_by: Optional[str] = None


class ClearedList(BaseModel):
    items: list[ClearedRow]
    total: int
    total_qty: float
    total_pallets: float
    total_boxes: float
    unacknowledged: int


def _cleared_row(
    r: CustomsWarehouseClearance,
    product_expiry: Optional[date] = None,
    documents: list[CustomsWarehouseClearanceDocument] | None = None,
    manufacturer: Optional[str] = None,
) -> ClearedRow:
    return ClearedRow(
        id=str(r.id),
        invoice_name=r.invoice_name,
        product_name=r.product_name,
        manufacturer=manufacturer,
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
        documents=[ClearedDocument(id=str(doc.id), file_name=doc.file_name,
                                   document_type=doc.document_type,
                                   size_bytes=doc.size_bytes) for doc in (documents or [])],
        no_sale_permission=(r.regime or "").upper() == "ND-40",
        sale_released=r.sale_released_at is not None,
        sale_released_at=r.sale_released_at,
        sale_released_by=r.sale_released_by,
    )


@router.get("/cleared", response_model=ClearedList)
def list_cleared(
    request: Request,
    db: Session = Depends(get_db),
    q: Optional[str] = Query(default=None),
    regime: Optional[str] = Query(default=None),
    view: str = Query(default="pending"),
) -> ClearedList:
    """Goods that have been cleared out of the customs warehouse (append-only
    ledger written by ANDROMEDA), newest first.

    `view`: 'pending' = not yet accepted (default), 'awaiting_cert' = accepted
    ND-40 goods awaiting a sale-permission certificate (or released < 2 days
    ago), 'archived' = accepted goods that have settled."""
    stmt = (
        select(
            CustomsWarehouseClearance,
            CustomsWarehouseProduct.product_expiry,
            AnalyticsProduct.manufacturer_label,
        )
        .outerjoin(
            CustomsWarehouseProduct,
            CustomsWarehouseClearance.product_id == CustomsWarehouseProduct.id,
        )
        .outerjoin(
            AnalyticsProduct,
            func.lower(AnalyticsProduct.name) == func.lower(CustomsWarehouseClearance.product_name),
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
    # ND-40 goods wait in the "Sertifikat kutilmoqda" view after acceptance.
    # They move to the archive only once the sale is released AND 2 days pass.
    is_nd40 = func.upper(func.coalesce(CustomsWarehouseClearance.regime, "")) == "ND-40"
    cutoff = datetime.now(timezone.utc) - timedelta(days=2)
    released_settled = and_(
        CustomsWarehouseClearance.sale_released_at.is_not(None),
        CustomsWarehouseClearance.sale_released_at <= cutoff,
    )
    awaiting_cert = and_(is_nd40, not_(released_settled))
    if view == "pending":
        stmt = stmt.where(CustomsWarehouseClearance.acknowledged_at.is_(None))
    elif view == "awaiting_cert":
        stmt = stmt.where(CustomsWarehouseClearance.acknowledged_at.is_not(None), awaiting_cert)
    elif view == "archived":
        stmt = stmt.where(CustomsWarehouseClearance.acknowledged_at.is_not(None), not_(awaiting_cert))
    rows = db.execute(stmt).all()
    username = getattr(request.state, "user_name", None)
    user = db.scalar(select(User).where(User.username == username, User.disabled.is_(False))) if username else None
    documents_by_clearance: dict[UUID, list[CustomsWarehouseClearanceDocument]] = {}
    if user and rows:
        visible_documents = db.scalars(
            select(CustomsWarehouseClearanceDocument).where(
                CustomsWarehouseClearanceDocument.clearance_id.in_([row[0].id for row in rows]),
                (
                    CustomsWarehouseClearanceDocument.recipient_user_ids.contains([user.id])
                    | (func.cardinality(CustomsWarehouseClearanceDocument.recipient_user_ids) == 0)
                ),
            ).order_by(CustomsWarehouseClearanceDocument.created_at)
        ).all()
        for doc in visible_documents:
            documents_by_clearance.setdefault(doc.clearance_id, []).append(doc)
    items = [_cleared_row(r[0], product_expiry=r[1],
                          documents=documents_by_clearance.get(r[0].id),
                          manufacturer=r[2]) for r in rows]
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


class DocumentRecipient(BaseModel):
    id: str
    username: str
    display_name: str


@router.get("/cleared/document-recipients", response_model=list[DocumentRecipient])
def list_clearance_document_recipients(request: Request, db: Session = Depends(get_db)) -> list[DocumentRecipient]:
    """Active accounts that may be granted visibility of a released document.
    Admin-only, since it feeds the release/upload dialog."""
    _require_admin(request)
    users = db.scalars(
        select(User)
        .where(User.disabled.is_(False), User.is_technical.is_(False))
        .order_by(User.display_name, User.username)
    ).all()
    return [
        DocumentRecipient(id=str(u.id), username=u.username, display_name=u.display_name or u.username)
        for u in users
    ]


_MAX_DOC_BYTES = 25 * 1024 * 1024
_MAX_TOTAL_BYTES = 50 * 1024 * 1024


def _safe_doc_name(name: Optional[str]) -> str:
    base = (name or "document").replace("\\", "/").split("/")[-1].strip()
    cleaned = "".join(c for c in base if c.isalnum() or c in " ._-()").strip()
    return cleaned[:150] or "document"


def _parse_recipient_groups(raw_json: Optional[str], file_count: int) -> list[list[UUID]]:
    if not raw_json:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Document recipients are required.")
    try:
        raw_groups = json.loads(raw_json)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid document recipients.") from exc
    if not isinstance(raw_groups, list) or len(raw_groups) != file_count:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Each document needs its own recipient list.")
    groups: list[list[UUID]] = []
    for raw_ids in raw_groups:
        if raw_ids == {"everyone": True}:  # explicit public choice -> empty list
            groups.append([])
            continue
        if not isinstance(raw_ids, list) or not 1 <= len(raw_ids) <= 100:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Each document needs at least one recipient.")
        try:
            groups.append(list(dict.fromkeys(UUID(v) for v in raw_ids)))
        except (ValueError, TypeError) as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid recipient id.") from exc
    return groups


def _parse_doc_types(raw_json: Optional[str], file_count: int) -> list[Optional[str]]:
    if not raw_json:
        return [None] * file_count
    try:
        values = json.loads(raw_json)
    except (ValueError, TypeError):
        return [None] * file_count
    if not isinstance(values, list) or len(values) != file_count:
        return [None] * file_count
    return [str(v) if v else None for v in values]


@router.post("/cleared/{clearance_id}/release", response_model=ClearedRow)
def release_cleared_sale(
    clearance_id: UUID,
    request: Request,
    document_recipients_json: str = Form(...),
    document_types_json: Optional[str] = Form(None),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
) -> ClearedRow:
    """Release an ND-40 clearance for sale: attach the certificate / IM-40
    (with per-document visibility) and mark the goods sellable. Admin-only."""
    actor = _require_admin(request)
    row = db.get(CustomsWarehouseClearance, clearance_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clearance not found.")
    if (row.regime or "").upper() != "ND-40":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Only ND-40 goods require a sale release.")
    if not files or len(files) > 10:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Attach between 1 and 10 documents.")

    recipient_groups = _parse_recipient_groups(document_recipients_json, len(files))
    doc_types = _parse_doc_types(document_types_json, len(files))
    recipient_ids = {uid for group in recipient_groups for uid in group}
    if recipient_ids:
        valid = db.scalars(
            select(User.id).where(
                User.id.in_(recipient_ids), User.disabled.is_(False), User.is_technical.is_(False)
            )
        ).all()
        if set(valid) != recipient_ids:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Select active users only.")

    # Read + size-check every file before uploading any.
    payloads: list[tuple[bytes, str, str]] = []  # (data, filename, content_type)
    total = 0
    for f in files:
        data = f.file.read()
        total += len(data)
        if len(data) == 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Empty document.")
        if len(data) > _MAX_DOC_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "A document exceeds 25 MB.")
        payloads.append((data, f.filename or "document", f.content_type or "application/octet-stream"))
    if total > _MAX_TOTAL_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Documents exceed 50 MB total.")

    for (data, filename, content_type), recipients, doc_type in zip(payloads, recipient_groups, doc_types):
        key = f"customs-warehouse/clearances/{uuid4()}/{_safe_doc_name(filename)}"
        try:
            r2.upload_document(key=key, body=io.BytesIO(data), content_type=content_type)
        except r2.R2NotConfigured:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Document storage is not configured.")
        except Exception:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Document storage is temporarily unavailable.")
        db.add(CustomsWarehouseClearanceDocument(
            clearance_id=row.id,
            file_name=_safe_doc_name(filename),
            document_type=doc_type,
            storage_path=key,
            size_bytes=len(data),
            mime_type=content_type,
            recipient_user_ids=list(recipients),
        ))

    row.sale_released_at = datetime.now(timezone.utc)
    row.sale_released_by = actor
    db.commit()
    db.refresh(row)
    record_event(actor=actor, action="clearance_sale_released", target=str(row.id), details={"product": row.product_name})
    documents = db.scalars(
        select(CustomsWarehouseClearanceDocument)
        .where(CustomsWarehouseClearanceDocument.clearance_id == row.id)
        .order_by(CustomsWarehouseClearanceDocument.created_at)
    ).all()
    return _cleared_row(row, documents=documents)


class CertificateUrl(BaseModel):
    url: str
    expires_in_seconds: int


@router.get("/cleared/documents/{document_id}/url", response_model=CertificateUrl)
def get_clearance_document_url(
    document_id: UUID, request: Request, db: Session = Depends(get_db),
) -> CertificateUrl:
    username = getattr(request.state, "user_name", None)
    user = db.scalar(select(User).where(User.username == username, User.disabled.is_(False))) if username else None
    doc = db.get(CustomsWarehouseClearanceDocument, document_id)
    if user is None or doc is None or (doc.recipient_user_ids and user.id not in doc.recipient_user_ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    ttl = min(settings.r2_presigned_ttl_seconds, 60)
    try:
        url = r2.create_download_url(
            key=doc.storage_path, ttl_seconds=ttl,
        )
    except r2.R2NotConfigured:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Document storage is not configured.")
    except Exception:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Document storage is temporarily unavailable.")
    return CertificateUrl(url=url, expires_in_seconds=ttl)


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
