"""Warehouses + per-warehouse stock — the "warehouse ostatok"."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..models import AnalyticsProduct, Warehouse, WarehouseStock

router = APIRouter(prefix="/warehouses", tags=["warehouses"])


# ── Product × warehouse matrix (grouped by project) ──────────────────────────
class MatrixWarehouse(BaseModel):
    id: str
    name: str
    code: Optional[str] = None
    project: Optional[str] = None


class MatrixProduct(BaseModel):
    product_id: str
    product_name: str
    product_group: Optional[str] = None
    project: Optional[str] = None
    warehouse_stocks: dict[str, float]


class WarehouseMatrix(BaseModel):
    warehouses: list[MatrixWarehouse]
    products: list[MatrixProduct]


@router.get("/matrix", response_model=WarehouseMatrix)
def warehouse_matrix(db: Session = Depends(get_db)) -> WarehouseMatrix:
    """Every active warehouse and every catalog product with its per-warehouse
    stock (nonzero cells only). The frontend groups warehouses by project and
    renders the pivot. Mirrors ANDROMEDA's /stocks/product-summary."""
    warehouses = db.scalars(
        select(Warehouse)
        .where(Warehouse.is_active.is_(True))
        .options(selectinload(Warehouse.project_rel))
        .order_by(Warehouse.name.asc())
    ).all()
    products = db.scalars(
        select(AnalyticsProduct)
        .options(selectinload(AnalyticsProduct.project_rel))
        .order_by(AnalyticsProduct.name.asc())
    ).all()
    stock_rows = db.execute(
        select(WarehouseStock.product_id, WarehouseStock.warehouse_id, WarehouseStock.quantity)
    ).all()

    by_product: dict = {}
    for pid, wid, qty in stock_rows:
        q = float(qty or 0)
        if q == 0:
            continue
        by_product.setdefault(pid, {})[str(wid)] = q

    return WarehouseMatrix(
        warehouses=[
            MatrixWarehouse(id=str(w.id), name=w.name, code=w.code, project=w.project_name)
            for w in warehouses
        ],
        products=[
            MatrixProduct(
                product_id=str(p.id),
                product_name=p.name,
                product_group=p.product_group,
                project=p.project_name,
                warehouse_stocks=by_product.get(p.id, {}),
            )
            for p in products
        ],
    )


class WarehouseRow(BaseModel):
    id: str
    name: str
    code: Optional[str] = None
    project_name: Optional[str] = None
    warehouse_type: Optional[str] = None
    city: Optional[str] = None
    is_active: bool
    product_count: int
    total_qty: float


@router.get("", response_model=list[WarehouseRow])
def list_warehouses(
    db: Session = Depends(get_db),
    include_inactive: bool = Query(default=False),
) -> list[WarehouseRow]:
    stmt = select(Warehouse).options(selectinload(Warehouse.project_rel))
    if not include_inactive:
        stmt = stmt.where(Warehouse.is_active.is_(True))
    warehouses = db.scalars(stmt.order_by(Warehouse.name)).all()

    # Aggregate product count + total quantity per warehouse in one grouped query.
    agg_rows = db.execute(
        select(
            WarehouseStock.warehouse_id,
            func.count(WarehouseStock.id),
            func.coalesce(func.sum(WarehouseStock.quantity), 0),
        ).group_by(WarehouseStock.warehouse_id)
    ).all()
    by_id = {wid: (int(cnt), float(total)) for (wid, cnt, total) in agg_rows}

    result: list[WarehouseRow] = []
    for w in warehouses:
        cnt, total = by_id.get(w.id, (0, 0.0))
        result.append(
            WarehouseRow(
                id=str(w.id),
                name=w.name,
                code=w.code,
                project_name=w.project_name,
                warehouse_type=w.warehouse_type,
                city=w.city,
                is_active=w.is_active,
                product_count=cnt,
                total_qty=total,
            )
        )
    return result


class WarehouseStockRow(BaseModel):
    product_id: str
    name: str
    manufacturer_label: Optional[str] = None
    project_name: Optional[str] = None
    quantity: float


class WarehouseStockPage(BaseModel):
    warehouse: WarehouseRow
    items: list[WarehouseStockRow]
    total: int
    page: int
    page_size: int


def _warehouse_row(db: Session, w: Warehouse) -> WarehouseRow:
    cnt, total = db.execute(
        select(
            func.count(WarehouseStock.id),
            func.coalesce(func.sum(WarehouseStock.quantity), 0),
        ).where(WarehouseStock.warehouse_id == w.id)
    ).one()
    return WarehouseRow(
        id=str(w.id),
        name=w.name,
        code=w.code,
        project_name=w.project_name,
        warehouse_type=w.warehouse_type,
        city=w.city,
        is_active=w.is_active,
        product_count=int(cnt),
        total_qty=float(total),
    )


@router.get("/{warehouse_id}/stock", response_model=WarehouseStockPage)
def warehouse_stock(
    warehouse_id: str,
    db: Session = Depends(get_db),
    q: Optional[str] = Query(default=None),
    only_in_stock: bool = Query(default=True),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
) -> WarehouseStockPage:
    w = db.get(Warehouse, warehouse_id)
    if w is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Warehouse not found.")

    stmt = (
        select(AnalyticsProduct, WarehouseStock.quantity)
        .join(WarehouseStock, WarehouseStock.product_id == AnalyticsProduct.id)
        .where(WarehouseStock.warehouse_id == w.id)
        .options(selectinload(AnalyticsProduct.project_rel))
    )
    count_stmt = (
        select(func.count())
        .select_from(WarehouseStock)
        .where(WarehouseStock.warehouse_id == w.id)
    )
    if only_in_stock:
        stmt = stmt.where(WarehouseStock.quantity > 0)
        count_stmt = count_stmt.where(WarehouseStock.quantity > 0)
    if q:
        like = AnalyticsProduct.name.ilike(f"%{q.strip()}%")
        # `stmt` already joins AnalyticsProduct; the count query needs its own join.
        stmt = stmt.where(like)
        count_stmt = count_stmt.join(
            AnalyticsProduct, WarehouseStock.product_id == AnalyticsProduct.id
        ).where(like)

    total = db.scalar(count_stmt) or 0
    rows = db.execute(
        stmt.order_by(AnalyticsProduct.name).offset((page - 1) * page_size).limit(page_size)
    ).all()
    items = [
        WarehouseStockRow(
            product_id=str(p.id),
            name=p.name,
            manufacturer_label=p.manufacturer_label,
            project_name=p.project_name,
            quantity=float(qty),
        )
        for (p, qty) in rows
    ]
    return WarehouseStockPage(
        warehouse=_warehouse_row(db, w),
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


class WarehouseStockUpdate(BaseModel):
    quantity: float


@router.put("/{warehouse_id}/stock/{product_id}", response_model=WarehouseStockRow)
def set_warehouse_stock(
    warehouse_id: str,
    product_id: str,
    payload: WarehouseStockUpdate,
    db: Session = Depends(get_db),
) -> WarehouseStockRow:
    w = db.get(Warehouse, warehouse_id)
    if w is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Warehouse not found.")
    product = db.get(AnalyticsProduct, product_id)
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found.")
    try:
        qty = Decimal(str(payload.quantity))
    except (InvalidOperation, ValueError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid quantity.")
    if qty < 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Quantity cannot be negative.")

    row = db.scalar(
        select(WarehouseStock).where(
            WarehouseStock.warehouse_id == w.id,
            WarehouseStock.product_id == product.id,
        )
    )
    if row is None:
        row = WarehouseStock(warehouse_id=w.id, product_id=product.id, quantity=qty)
        db.add(row)
    else:
        row.quantity = qty
    db.commit()
    return WarehouseStockRow(
        product_id=str(product.id),
        name=product.name,
        manufacturer_label=product.manufacturer_label,
        project_name=product.project_name,
        quantity=float(qty),
    )
