"""Company-wide stock — the "company ostatok".

Read for everyone; quantity edits require a non-guest role (enforced globally
by the auth gate for write methods).
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..models import AnalyticsProduct, AnalyticsStockCompany

router = APIRouter(prefix="/company-stock", tags=["company-stock"])


class CompanyStockRow(BaseModel):
    product_id: str
    name: str
    manufacturer_label: Optional[str] = None
    project_name: Optional[str] = None
    catalog_category: Optional[str] = None
    qty: float


class CompanyStockPage(BaseModel):
    items: list[CompanyStockRow]
    total: int
    page: int
    page_size: int
    products_in_stock: int


@router.get("", response_model=CompanyStockPage)
def list_company_stock(
    db: Session = Depends(get_db),
    q: Optional[str] = Query(default=None),
    manufacturer: Optional[str] = Query(default=None),
    project_id: Optional[str] = Query(default=None),
    only_in_stock: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
) -> CompanyStockPage:
    stmt = (
        select(AnalyticsProduct, AnalyticsStockCompany.qty)
        .join(
            AnalyticsStockCompany,
            AnalyticsStockCompany.analytics_product_id == AnalyticsProduct.id,
            isouter=not only_in_stock,
        )
        .options(selectinload(AnalyticsProduct.project_rel))
    )
    count_stmt = (
        select(func.count())
        .select_from(AnalyticsProduct)
        .join(
            AnalyticsStockCompany,
            AnalyticsStockCompany.analytics_product_id == AnalyticsProduct.id,
            isouter=not only_in_stock,
        )
    )

    filters = []
    if q:
        filters.append(AnalyticsProduct.name.ilike(f"%{q.strip()}%"))
    if manufacturer:
        filters.append(AnalyticsProduct.manufacturer_label == manufacturer)
    if project_id:
        filters.append(AnalyticsProduct.project_id == project_id)
    for f in filters:
        stmt = stmt.where(f)
        count_stmt = count_stmt.where(f)

    total = db.scalar(count_stmt) or 0
    products_in_stock = db.scalar(
        select(func.count()).select_from(AnalyticsStockCompany).where(AnalyticsStockCompany.qty > 0)
    ) or 0

    rows = db.execute(
        stmt.order_by(AnalyticsProduct.name).offset((page - 1) * page_size).limit(page_size)
    ).all()

    items = [
        CompanyStockRow(
            product_id=str(p.id),
            name=p.name,
            manufacturer_label=p.manufacturer_label,
            project_name=p.project_name,
            catalog_category=p.catalog_category,
            qty=float(qty) if qty is not None else 0.0,
        )
        for (p, qty) in rows
    ]
    return CompanyStockPage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        products_in_stock=products_in_stock,
    )


class CompanyStockUpdate(BaseModel):
    qty: float


@router.put("/{product_id}", response_model=CompanyStockRow)
def set_company_stock(
    product_id: str,
    payload: CompanyStockUpdate,
    db: Session = Depends(get_db),
) -> CompanyStockRow:
    product = db.get(AnalyticsProduct, product_id)
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found.")
    try:
        qty = Decimal(str(payload.qty))
    except (InvalidOperation, ValueError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid quantity.")
    if qty < 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Quantity cannot be negative.")

    row = db.scalar(
        select(AnalyticsStockCompany).where(
            AnalyticsStockCompany.analytics_product_id == product.id
        )
    )
    if row is None:
        row = AnalyticsStockCompany(analytics_product_id=product.id, qty=qty)
        db.add(row)
    else:
        row.qty = qty
    db.commit()
    return CompanyStockRow(
        product_id=str(product.id),
        name=product.name,
        manufacturer_label=product.manufacturer_label,
        project_name=product.project_name,
        catalog_category=product.catalog_category,
        qty=float(qty),
    )
