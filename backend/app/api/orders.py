"""Read-only monthly purchase orders from ANDROMEDA's shared analytics tables."""
from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..config import settings
from ..db import get_db
from ..models import AnalyticsOrders, AnalyticsProduct
from ..storage import r2

router = APIRouter(prefix="/orders", tags=["orders"])


class OrderRow(BaseModel):
    id: UUID
    product_id: UUID
    product_name: str
    external_id: str | None = None
    project_name: str | None = None
    manufacturer_label: str | None = None
    month: date
    qty: float
    file_name: str | None = None
    size_bytes: int | None = None
    mime_type: str | None = None
    uploaded_at: datetime | None = None


class OrderPage(BaseModel):
    items: list[OrderRow]
    total: int
    total_qty: float
    page: int
    page_size: int


class OrderLookups(BaseModel):
    groups: list[str]
    manufacturers: list[str]


@router.get("/lookups", response_model=OrderLookups)
def order_lookups(db: Session = Depends(get_db)) -> OrderLookups:
    groups = db.scalars(
        select(AnalyticsProduct.product_group)
        .join(AnalyticsOrders, AnalyticsOrders.analytics_product_id == AnalyticsProduct.id)
        .where(AnalyticsOrders.qty > 0, AnalyticsProduct.product_group.is_not(None))
        .distinct().order_by(AnalyticsProduct.product_group)
    ).all()
    label = func.coalesce(AnalyticsOrders.manufacturer_label, AnalyticsProduct.manufacturer_label)
    manufacturers = db.scalars(
        select(label).join(AnalyticsOrders.product)
        .where(AnalyticsOrders.qty > 0, label.is_not(None))
        .distinct().order_by(label)
    ).all()
    return OrderLookups(groups=groups, manufacturers=manufacturers)


@router.get("", response_model=OrderPage)
def list_orders(
    db: Session = Depends(get_db),
    q: str | None = Query(default=None),
    manufacturer: str | None = Query(default=None),
    group: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> OrderPage:
    conditions = [AnalyticsOrders.qty > 0]
    if q and q.strip():
        needle = f"%{q.strip()}%"
        conditions.append(or_(
            AnalyticsProduct.name.ilike(needle),
            AnalyticsProduct.external_id.ilike(needle),
            AnalyticsOrders.file_name.ilike(needle),
        ))
    if manufacturer:
        conditions.append(func.coalesce(
            AnalyticsOrders.manufacturer_label, AnalyticsProduct.manufacturer_label,
        ) == manufacturer)
    if group:
        conditions.append(AnalyticsProduct.product_group == group)

    base = select(AnalyticsOrders).join(AnalyticsOrders.product).where(*conditions)
    total, total_qty = db.execute(
        select(func.count(), func.coalesce(func.sum(AnalyticsOrders.qty), 0))
        .join(AnalyticsOrders.product)
        .where(*conditions)
    ).one()
    orders = db.scalars(
        base.options(selectinload(AnalyticsOrders.product).selectinload(AnalyticsProduct.project_rel))
        .order_by(AnalyticsOrders.month.desc(), AnalyticsProduct.name, AnalyticsOrders.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return OrderPage(
        items=[OrderRow(
            id=order.id,
            product_id=order.analytics_product_id,
            product_name=order.product.name,
            external_id=order.product.external_id,
            project_name=order.product.product_group or order.product.project_name,
            manufacturer_label=order.manufacturer_label or order.product.manufacturer_label,
            month=order.month,
            qty=float(order.qty),
            file_name=order.file_name,
            size_bytes=order.size_bytes,
            mime_type=order.mime_type,
            uploaded_at=order.uploaded_at,
        ) for order in orders],
        total=total,
        total_qty=float(total_qty),
        page=page,
        page_size=page_size,
    )


class DocumentUrl(BaseModel):
    url: str
    expires_in_seconds: int


@router.get("/{order_id}/document-url", response_model=DocumentUrl)
def order_document_url(order_id: UUID, db: Session = Depends(get_db)) -> DocumentUrl:
    order = db.get(AnalyticsOrders, order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found.")
    if not order.storage_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order has no attached document.")
    try:
        url = r2.create_download_url(
            key=order.storage_path,
            ttl_seconds=settings.r2_presigned_ttl_seconds,
        )
    except r2.R2NotConfigured:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Order document storage is not configured.")
    except r2.R2Error:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Order document storage is temporarily unavailable.")
    return DocumentUrl(url=url, expires_in_seconds=settings.r2_presigned_ttl_seconds)
