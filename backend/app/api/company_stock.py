"""Company-wide stock — the "company ostatok" — enriched to match ANDROMEDA.

Each row carries, alongside the company balance:
  * customs stock (derived live from customs_warehouse_products in the
    IM-74 / TR-80 regimes, matched to the catalog product by name),
  * open orders for the current+future months (shown as +qty),
  * average monthly sales (Excel AVERAGEIF over a trailing 3-month window,
    combining otgruzka and sell-through — identical to ANDROMEDA),
  * warehouse-based coverage (prognoz) = warehouse stock ÷ average sales.

Read for everyone; quantity edits require a non-guest role (enforced globally
by the auth gate). Formula parity source: custom_control/src/analytics.py.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..models import (
    AnalyticsFactSales,
    AnalyticsOrders,
    AnalyticsProduct,
    AnalyticsReceived,
    AnalyticsSales,
    AnalyticsStockCompany,
    CustomsWarehouseProduct,
    Warehouse,
    WarehouseStock,
)

router = APIRouter(prefix="/company-stock", tags=["company-stock"])

# Trailing months used for the rolling sales average + coverage (ANDROMEDA
# COVERAGE_WINDOW). Coverage above this many months is considered healthy.
COVERAGE_WINDOW = 3
COVERAGE_THRESHOLD = 4
ORDER_CLOSE_THRESHOLD = 0.9
# Regimes matched to catalog products by name (like ANDROMEDA analytics_full).
CUSTOMS_REGIMES = ("IM-74", "TR-80")   # real customs stock
INCOMING_REGIMES = ("INCOMING",)       # goods on the way → shown as orange +qty


def _month_first(d: date) -> date:
    return date(d.year, d.month, 1)


def _add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    return date(d.year + m // 12, m % 12 + 1, 1)


class CompanyStockRow(BaseModel):
    product_id: str
    name: str
    manufacturer_label: Optional[str] = None
    project_name: Optional[str] = None
    catalog_category: Optional[str] = None
    qty: float                 # company stock (analytics_stock_company)
    customs_qty: float         # customs warehouse stock (IM-74 / TR-80)
    order_qty: float           # open orders, current+future months (plain)
    incoming_qty: float        # goods on the way (INCOMING regime) → orange +qty
    avg_sales: float
    warehouse_qty: float       # total across warehouses
    coverage_months: Optional[float] = None  # warehouse_qty / avg_sales


class CompanyStockPage(BaseModel):
    items: list[CompanyStockRow]
    total: int
    page: int
    page_size: int
    products_in_stock: int


def _series_avg(db: Session, model, ids: list, window_start: date, window_end: date) -> dict:
    """Excel AVERAGEIF(<>0): per product, Σ(monthly qty) ÷ months-with-sales,
    over the trailing window. Months whose summed qty is zero don't count."""
    rows = db.execute(
        select(model.analytics_product_id, model.month, func.sum(model.qty))
        .where(
            model.analytics_product_id.in_(ids),
            model.month >= window_start,
            model.month <= window_end,
        )
        .group_by(model.analytics_product_id, model.month)
    ).all()
    agg: dict = {}
    for pid, _month, qty in rows:
        q = float(qty or 0)
        if q == 0:
            continue
        acc = agg.setdefault(pid, [0.0, 0])
        acc[0] += q
        acc[1] += 1
    return {pid: (v[0] / v[1] if v[1] else 0.0) for pid, v in agg.items()}


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
    products = [p for (p, _q) in rows]
    company_qty = {p.id: float(qty) if qty is not None else 0.0 for (p, qty) in rows}
    ids = [p.id for p in products]

    customs_by_name: dict = {}
    incoming_by_name: dict = {}
    warehouse_total: dict = {}
    avg_ot: dict = {}
    avg_fs: dict = {}
    open_future: dict = {}

    if ids:
        # Warehouse totals per product.
        for pid, tot in db.execute(
            select(WarehouseStock.product_id, func.coalesce(func.sum(WarehouseStock.quantity), 0))
            .where(WarehouseStock.product_id.in_(ids))
            .group_by(WarehouseStock.product_id)
        ).all():
            warehouse_total[pid] = float(tot or 0)

        lower_names = {p.name.lower() for p in products}

        def customs_qty_by_name(regimes: tuple[str, ...]) -> dict:
            out: dict = {}
            for lname, tot in db.execute(
                select(
                    func.lower(CustomsWarehouseProduct.product_name),
                    func.coalesce(func.sum(CustomsWarehouseProduct.qty), 0),
                )
                .where(
                    CustomsWarehouseProduct.regime.in_(regimes),
                    func.lower(CustomsWarehouseProduct.product_name).in_(lower_names),
                )
                .group_by(func.lower(CustomsWarehouseProduct.product_name))
            ).all():
                out[lname] = float(tot or 0)
            return out

        # Real customs stock (IM-74/TR-80) and incoming goods (INCOMING regime),
        # both matched to catalog products by name — exactly as ANDROMEDA does.
        customs_by_name = customs_qty_by_name(CUSTOMS_REGIMES)
        incoming_by_name = customs_qty_by_name(INCOMING_REGIMES)

        # Average sales over the trailing window ending the previous full month.
        current_first = _month_first(date.today())
        window_end = _add_months(current_first, -1)
        window_start = _add_months(window_end, -(COVERAGE_WINDOW - 1))
        avg_ot = _series_avg(db, AnalyticsSales, ids, window_start, window_end)
        avg_fs = _series_avg(db, AnalyticsFactSales, ids, window_start, window_end)

        # Open orders in current+future months (received < 90% of ordered) —
        # the plain "Orders" number (ANDROMEDA openOrdersFuture).
        order_rows = db.execute(
            select(AnalyticsOrders.analytics_product_id, AnalyticsOrders.month, func.coalesce(func.sum(AnalyticsOrders.qty), 0))
            .where(AnalyticsOrders.analytics_product_id.in_(ids), AnalyticsOrders.month >= current_first)
            .group_by(AnalyticsOrders.analytics_product_id, AnalyticsOrders.month)
        ).all()
        recv_rows = db.execute(
            select(AnalyticsReceived.analytics_product_id, AnalyticsReceived.month, func.coalesce(func.sum(AnalyticsReceived.qty), 0))
            .where(AnalyticsReceived.analytics_product_id.in_(ids), AnalyticsReceived.month >= current_first)
            .group_by(AnalyticsReceived.analytics_product_id, AnalyticsReceived.month)
        ).all()
        recv_map = {(pid, m): float(qty or 0) for pid, m, qty in recv_rows}
        for pid, m, oq in order_rows:
            ordered = float(oq or 0)
            if ordered <= 0:
                continue
            received = recv_map.get((pid, m), 0.0)
            if received >= ordered * ORDER_CLOSE_THRESHOLD:  # order closed
                continue
            open_qty = ordered - received
            if open_qty > 0:
                open_future[pid] = open_future.get(pid, 0.0) + open_qty

    items: list[CompanyStockRow] = []
    for p in products:
        a_ot = avg_ot.get(p.id, 0.0)
        a_fs = avg_fs.get(p.id, 0.0)
        avg_sales = (a_ot + a_fs) / 2 if a_ot > 0 and a_fs > 0 else (a_ot or a_fs)
        wh = warehouse_total.get(p.id, 0.0)
        coverage = wh / avg_sales if avg_sales > 0 else None
        items.append(
            CompanyStockRow(
                product_id=str(p.id),
                name=p.name,
                manufacturer_label=p.manufacturer_label,
                project_name=p.project_name,
                catalog_category=p.catalog_category,
                qty=company_qty.get(p.id, 0.0),
                customs_qty=customs_by_name.get(p.name.lower(), 0.0),
                order_qty=open_future.get(p.id, 0.0),
                incoming_qty=incoming_by_name.get(p.name.lower(), 0.0),
                avg_sales=avg_sales,
                warehouse_qty=wh,
                coverage_months=coverage,
            )
        )

    return CompanyStockPage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        products_in_stock=products_in_stock,
    )


# ── Warehouse breakdown for the clickable stock modal ────────────────────────
class WarehouseBreakdownRow(BaseModel):
    warehouse_id: str
    warehouse_name: str
    warehouse_code: Optional[str] = None
    quantity: float


class WarehouseBreakdown(BaseModel):
    product_id: str
    product_name: str
    product_group: Optional[str] = None
    total_stock: float
    warehouses: list[WarehouseBreakdownRow]


@router.get("/{product_id}/warehouse-breakdown", response_model=WarehouseBreakdown)
def warehouse_breakdown(product_id: str, db: Session = Depends(get_db)) -> WarehouseBreakdown:
    product = db.get(AnalyticsProduct, product_id)
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found.")
    rows = db.execute(
        select(Warehouse.id, Warehouse.name, Warehouse.code, func.coalesce(WarehouseStock.quantity, 0))
        .join(
            WarehouseStock,
            (WarehouseStock.warehouse_id == Warehouse.id) & (WarehouseStock.product_id == product.id),
        )
        .where(Warehouse.is_active.is_(True))
        .order_by(Warehouse.name.asc())
    ).all()
    warehouses = [
        WarehouseBreakdownRow(
            warehouse_id=str(wid), warehouse_name=name, warehouse_code=code, quantity=float(qty or 0)
        )
        for (wid, name, code, qty) in rows
    ]
    return WarehouseBreakdown(
        product_id=str(product.id),
        product_name=product.name,
        product_group=product.project_name,
        total_stock=sum(w.quantity for w in warehouses),
        warehouses=warehouses,
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
        select(AnalyticsStockCompany).where(AnalyticsStockCompany.analytics_product_id == product.id)
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
        customs_qty=0.0,
        order_qty=0.0,
        incoming_qty=0.0,
        avg_sales=0.0,
        warehouse_qty=0.0,
        coverage_months=None,
    )
