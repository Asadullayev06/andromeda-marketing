"""Sales analytics — monthly dispatch (otgruzka) and sell-through series.

`analytics_sales` = otgruzka (dispatches); `analytics_fact_sales` = actual
sell-through. The Sales dashboard renders both. All read-only.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AnalyticsFactSales, AnalyticsProduct, AnalyticsSales

router = APIRouter(prefix="/sales", tags=["sales"])


class MonthlyPoint(BaseModel):
    month: date
    dispatched: float
    sold: float


class SalesOverview(BaseModel):
    months: list[MonthlyPoint]
    total_dispatched: float
    total_sold: float
    previous_dispatched: float
    previous_sold: float
    sell_through_rate: float | None = None


@router.get("/overview", response_model=SalesOverview)
def sales_overview(
    db: Session = Depends(get_db),
    months: int = Query(default=12, ge=1, le=36),
    manufacturer: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    product_id: str | None = Query(default=None),
) -> SalesOverview:
    def monthly(model):
        stmt = select(model.month, func.coalesce(func.sum(model.qty), 0))
        if any((manufacturer, project_id, product_id)):
            stmt = stmt.join(AnalyticsProduct, AnalyticsProduct.id == model.analytics_product_id)
        if manufacturer:
            stmt = stmt.where(AnalyticsProduct.manufacturer_label == manufacturer)
        if project_id:
            stmt = stmt.where(AnalyticsProduct.project_id == project_id)
        if product_id:
            stmt = stmt.where(AnalyticsProduct.id == product_id)
        return dict(db.execute(stmt.group_by(model.month)).all())
    dispatched = monthly(AnalyticsSales)
    sold = monthly(AnalyticsFactSales)
    all_months = sorted(set(dispatched) | set(sold))[-months:]
    previous_months = sorted(set(dispatched) | set(sold))[-(months * 2):-months]
    points = [
        MonthlyPoint(
            month=m,
            dispatched=float(dispatched.get(m, 0) or 0),
            sold=float(sold.get(m, 0) or 0),
        )
        for m in all_months
    ]
    return SalesOverview(
        months=points,
        total_dispatched=sum(p.dispatched for p in points),
        total_sold=sum(p.sold for p in points),
        previous_dispatched=sum(float(dispatched.get(m, 0) or 0) for m in previous_months),
        previous_sold=sum(float(sold.get(m, 0) or 0) for m in previous_months),
        sell_through_rate=(sum(p.sold for p in points) / sum(p.dispatched for p in points) * 100) if sum(p.dispatched for p in points) > 0 else None,
    )


class ProductSalesRow(BaseModel):
    product_id: str
    name: str
    manufacturer_label: str | None = None
    dispatched: float
    sold: float
    sell_through_rate: float | None = None
    variance: float


class TopProductsResponse(BaseModel):
    items: list[ProductSalesRow]


@router.get("/top-products", response_model=TopProductsResponse)
def top_products(
    db: Session = Depends(get_db),
    months: int = Query(default=6, ge=1, le=36),
    limit: int = Query(default=20, ge=1, le=200),
    manufacturer: str | None = Query(default=None),
    project_id: str | None = Query(default=None),
    q: str | None = Query(default=None),
) -> TopProductsResponse:
    # Window start = first day of the month `months` back from the latest month.
    latest = db.scalar(select(func.max(AnalyticsSales.month)))
    if latest is None:
        return TopProductsResponse(items=[])
    cutoff = date(latest.year, latest.month, 1)
    for _ in range(months - 1):
        cutoff = date(cutoff.year - 1, 12, 1) if cutoff.month == 1 else date(cutoff.year, cutoff.month - 1, 1)

    disp = dict(
        db.execute(
            select(
                AnalyticsSales.analytics_product_id,
                func.coalesce(func.sum(AnalyticsSales.qty), 0),
            )
            .where(AnalyticsSales.month >= cutoff)
            .group_by(AnalyticsSales.analytics_product_id)
        ).all()
    )
    sold = dict(
        db.execute(
            select(
                AnalyticsFactSales.analytics_product_id,
                func.coalesce(func.sum(AnalyticsFactSales.qty), 0),
            )
            .where(AnalyticsFactSales.month >= cutoff)
            .group_by(AnalyticsFactSales.analytics_product_id)
        ).all()
    )
    product_ids = set(disp) | set(sold)
    if not product_ids:
        return TopProductsResponse(items=[])
    product_stmt = select(AnalyticsProduct).where(AnalyticsProduct.id.in_(product_ids))
    if manufacturer:
        product_stmt = product_stmt.where(AnalyticsProduct.manufacturer_label == manufacturer)
    if project_id:
        product_stmt = product_stmt.where(AnalyticsProduct.project_id == project_id)
    if q:
        product_stmt = product_stmt.where(AnalyticsProduct.name.ilike(f"%{q.strip()}%"))
    products = {
        p.id: p
        for p in db.scalars(product_stmt).all()
    }
    rows = [
        ProductSalesRow(
            product_id=str(pid),
            name=products[pid].name if pid in products else "—",
            manufacturer_label=products[pid].manufacturer_label if pid in products else None,
            dispatched=float(disp.get(pid, 0) or 0),
            sold=float(sold.get(pid, 0) or 0),
            sell_through_rate=(float(sold.get(pid, 0) or 0) / float(disp.get(pid, 0) or 0) * 100) if float(disp.get(pid, 0) or 0) > 0 else None,
            variance=float(sold.get(pid, 0) or 0) - float(disp.get(pid, 0) or 0),
        )
        for pid in product_ids
        if pid in products
    ]
    rows.sort(key=lambda r: r.dispatched, reverse=True)
    return TopProductsResponse(items=rows[:limit])


class ProductSeriesResponse(BaseModel):
    product_id: str
    name: str
    months: list[MonthlyPoint]


@router.get("/product/{product_id}", response_model=ProductSeriesResponse)
def product_series(
    product_id: str,
    db: Session = Depends(get_db),
    months: int = Query(default=12, ge=1, le=36),
) -> ProductSeriesResponse:
    product = db.get(AnalyticsProduct, product_id)
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found.")
    dispatched = dict(
        db.execute(
            select(AnalyticsSales.month, func.coalesce(func.sum(AnalyticsSales.qty), 0))
            .where(AnalyticsSales.analytics_product_id == product.id)
            .group_by(AnalyticsSales.month)
        ).all()
    )
    sold = dict(
        db.execute(
            select(AnalyticsFactSales.month, func.coalesce(func.sum(AnalyticsFactSales.qty), 0))
            .where(AnalyticsFactSales.analytics_product_id == product.id)
            .group_by(AnalyticsFactSales.month)
        ).all()
    )
    all_months = sorted(set(dispatched) | set(sold))[-months:]
    points = [
        MonthlyPoint(
            month=m,
            dispatched=float(dispatched.get(m, 0) or 0),
            sold=float(sold.get(m, 0) or 0),
        )
        for m in all_months
    ]
    return ProductSeriesResponse(product_id=str(product.id), name=product.name, months=points)
