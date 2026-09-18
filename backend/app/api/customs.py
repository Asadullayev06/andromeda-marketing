"""Customs warehouse — the "customs ostatok".

Read-only listing of customs invoices, their products, and per-batch series,
with currency-separated totals (USD / EUR / UZS never blended).
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..models import (
    CustomsWarehouseInvoice,
    CustomsWarehouseProduct,
    CustomsWarehouseSeries,
)

router = APIRouter(prefix="/customs", tags=["customs"])


class SeriesRow(BaseModel):
    id: str
    batch: str
    qty: float


class CustomsProductRow(BaseModel):
    id: str
    product_name: str
    regime: str
    category: str
    qty: float
    invoice_sum: float
    currency: str
    product_expiry: Optional[date] = None
    brutto_kg: Optional[float] = None
    netto_kg: Optional[float] = None
    series: list[SeriesRow]


class CustomsInvoiceRow(BaseModel):
    id: str
    name: str
    supplier_label: str
    regime_expiry: Optional[date] = None
    invoice_cost: float
    invoice_currency: str
    logistic_cost: float
    currency: str
    certificate_status: str
    total_qty: float
    product_count: int
    products: list[CustomsProductRow]


def _product_row(p: CustomsWarehouseProduct) -> CustomsProductRow:
    return CustomsProductRow(
        id=str(p.id),
        product_name=p.product_name,
        regime=p.regime,
        category=p.category,
        qty=float(p.qty),
        invoice_sum=float(p.invoice_sum),
        currency=p.currency,
        product_expiry=p.product_expiry,
        brutto_kg=float(p.brutto_kg) if p.brutto_kg is not None else None,
        netto_kg=float(p.netto_kg) if p.netto_kg is not None else None,
        series=[SeriesRow(id=str(s.id), batch=s.batch, qty=float(s.qty)) for s in p.series],
    )


def _invoice_row(inv: CustomsWarehouseInvoice) -> CustomsInvoiceRow:
    products = [_product_row(p) for p in inv.products]
    return CustomsInvoiceRow(
        id=str(inv.id),
        name=inv.name,
        supplier_label=inv.supplier_label,
        regime_expiry=inv.regime_expiry,
        invoice_cost=float(inv.invoice_cost),
        invoice_currency=inv.invoice_currency,
        logistic_cost=float(inv.logistic_cost),
        currency=inv.currency,
        certificate_status=inv.certificate_status,
        total_qty=sum(p.qty for p in products),
        product_count=len(products),
        products=products,
    )


class CustomsListResponse(BaseModel):
    items: list[CustomsInvoiceRow]
    total_invoices: int
    total_products: int
    total_qty: float


@router.get("", response_model=CustomsListResponse)
def list_customs(
    db: Session = Depends(get_db),
    q: Optional[str] = Query(default=None),
    regime: Optional[str] = Query(default=None),
) -> CustomsListResponse:
    stmt = (
        select(CustomsWarehouseInvoice)
        .options(
            selectinload(CustomsWarehouseInvoice.products).selectinload(
                CustomsWarehouseProduct.series
            )
        )
        .order_by(CustomsWarehouseInvoice.created_at.desc())
    )
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            CustomsWarehouseInvoice.name.ilike(like)
            | CustomsWarehouseInvoice.supplier_label.ilike(like)
        )
    invoices = db.scalars(stmt).all()

    rows = [_invoice_row(inv) for inv in invoices]
    if regime:
        # Keep only invoices that contain at least one product in this regime,
        # narrowing each invoice's product list to the matching regime.
        filtered: list[CustomsInvoiceRow] = []
        for row in rows:
            matching = [p for p in row.products if p.regime == regime]
            if matching:
                row.products = matching
                row.product_count = len(matching)
                row.total_qty = sum(p.qty for p in matching)
                filtered.append(row)
        rows = filtered

    return CustomsListResponse(
        items=rows,
        total_invoices=len(rows),
        total_products=sum(r.product_count for r in rows),
        total_qty=sum(r.total_qty for r in rows),
    )


@router.get("/{invoice_id}", response_model=CustomsInvoiceRow)
def get_invoice(invoice_id: str, db: Session = Depends(get_db)) -> CustomsInvoiceRow:
    inv = db.scalar(
        select(CustomsWarehouseInvoice)
        .where(CustomsWarehouseInvoice.id == invoice_id)
        .options(
            selectinload(CustomsWarehouseInvoice.products).selectinload(
                CustomsWarehouseProduct.series
            )
        )
    )
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found.")
    return _invoice_row(inv)
