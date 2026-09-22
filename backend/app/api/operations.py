"""Cross-module marketing insights without adding tables to the shared schema."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
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
    Certificate,
    CertificateProductLink,
    CustomsWarehouseProduct,
    Warehouse,
    WarehouseStock,
)
from ..services.audit import recent_events, record_event
from ..services.expiry_store import import_workbook, indexes, normalize_product_name, rows_for_product, snapshot_info
from .company_stock import CUSTOMS_REGIMES, INCOMING_REGIMES, _add_months, _month_first, _series_avg

router = APIRouter(prefix="/operations", tags=["operations"])


def _require_admin(request: Request) -> str:
    role = getattr(request.state, "user_role", None)
    if role not in ("admin", "sysadmin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Administrator access is required.")
    return getattr(request.state, "user_name", "unknown")


class SnapshotInfo(BaseModel):
    source: str
    imported_at: date
    row_count: int
    aggregated_row_count: int
    product_count: int
    total_quantity: float
    age_days: int
    is_stale: bool


@router.get("/expiry/status", response_model=SnapshotInfo)
def expiry_status() -> SnapshotInfo:
    return SnapshotInfo(**snapshot_info())


@router.post("/expiry/import", response_model=SnapshotInfo)
async def expiry_import(request: Request, file: UploadFile = File(...)) -> SnapshotInfo:
    actor = _require_admin(request)
    content = await file.read()
    try:
        result = import_workbook(content, file.filename or "stock-details.xlsx")
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    record_event(actor=actor, action="expiry_snapshot.imported", target=file.filename or "workbook", details=result)
    return SnapshotInfo(**result)


class DashboardSummary(BaseModel):
    company_products: int
    warehouses: int
    customs_positions: int
    dispatched_12m: float
    sold_12m: float
    expiring_batches: int
    low_stock_products: int
    expiry_snapshot: SnapshotInfo


@router.get("/summary", response_model=DashboardSummary)
def dashboard_summary(db: Session = Depends(get_db)) -> DashboardSummary:
    current = _month_first(date.today())
    start = _add_months(current, -12)
    dispatched = db.scalar(select(func.coalesce(func.sum(AnalyticsSales.qty), 0)).where(AnalyticsSales.month >= start)) or 0
    sold = db.scalar(select(func.coalesce(func.sum(AnalyticsFactSales.qty), 0)).where(AnalyticsFactSales.month >= start)) or 0
    products = db.scalars(select(AnalyticsProduct)).all()
    ids = [p.id for p in products]
    window_end = _add_months(current, -1)
    window_start = _add_months(window_end, -2)
    avg_ot = _series_avg(db, AnalyticsSales, ids, window_start, window_end) if ids else {}
    avg_fs = _series_avg(db, AnalyticsFactSales, ids, window_start, window_end) if ids else {}
    wh = dict(db.execute(select(WarehouseStock.product_id, func.sum(WarehouseStock.quantity)).group_by(WarehouseStock.product_id)).all())
    low = 0
    for product in products:
        a = avg_ot.get(product.id, 0.0)
        b = avg_fs.get(product.id, 0.0)
        avg = (a + b) / 2 if a > 0 and b > 0 else (a or b)
        if avg > 0 and float(wh.get(product.id, 0) or 0) / avg <= 2:
            low += 1
    expiry_cutoff = date.today() + timedelta(days=180)
    expiring = 0
    for product in products:
        expiring += sum(
            1 for row in rows_for_product(product)
            if row.get("expiry_date") and date.fromisoformat(row["expiry_date"]) <= expiry_cutoff
        )
    return DashboardSummary(
        company_products=int(db.scalar(select(func.count()).select_from(AnalyticsStockCompany).where(AnalyticsStockCompany.qty > 0)) or 0),
        warehouses=int(db.scalar(select(func.count()).select_from(Warehouse).where(Warehouse.is_active.is_(True))) or 0),
        customs_positions=int(db.scalar(select(func.count()).select_from(CustomsWarehouseProduct)) or 0),
        dispatched_12m=float(dispatched),
        sold_12m=float(sold),
        expiring_batches=expiring,
        low_stock_products=low,
        expiry_snapshot=SnapshotInfo(**snapshot_info()),
    )


class AlertRow(BaseModel):
    id: str
    kind: str
    severity: str
    product_id: Optional[str] = None
    product_name: str
    detail: str
    quantity: Optional[float] = None
    date: Optional[date] = None


@router.get("/alerts", response_model=list[AlertRow])
def alerts(db: Session = Depends(get_db), limit: int = Query(default=300, ge=1, le=1000)) -> list[AlertRow]:
    today = date.today()
    products = db.scalars(select(AnalyticsProduct)).all()
    ids = [p.id for p in products]
    current = _month_first(today)
    end = _add_months(current, -1)
    start = _add_months(end, -2)
    avg_ot = _series_avg(db, AnalyticsSales, ids, start, end) if ids else {}
    avg_fs = _series_avg(db, AnalyticsFactSales, ids, start, end) if ids else {}
    stock = dict(db.execute(select(WarehouseStock.product_id, func.sum(WarehouseStock.quantity)).group_by(WarehouseStock.product_id)).all())
    result: list[AlertRow] = []
    for product in products:
        for index, row in enumerate(rows_for_product(product)):
            if not row.get("expiry_date"):
                continue
            expiry = date.fromisoformat(row["expiry_date"])
            days = (expiry - today).days
            if days <= 365:
                severity = "critical" if days <= 180 else "warning"
                detail = "Expired" if days < 0 else f"Expires in {days} days"
                result.append(AlertRow(id=f"expiry:{product.id}:{index}", kind="expiry", severity=severity, product_id=str(product.id), product_name=product.name, detail=detail, quantity=float(row.get("quantity") or 0), date=expiry))
        a = avg_ot.get(product.id, 0.0)
        b = avg_fs.get(product.id, 0.0)
        avg = (a + b) / 2 if a > 0 and b > 0 else (a or b)
        if avg > 0:
            coverage = float(stock.get(product.id, 0) or 0) / avg
            if coverage <= 2:
                result.append(AlertRow(id=f"stock:{product.id}", kind="low_stock", severity="critical" if coverage <= 1 else "warning", product_id=str(product.id), product_name=product.name, detail=f"{coverage:.1f} months of stock", quantity=float(stock.get(product.id, 0) or 0)))
            elif coverage > 12:
                result.append(AlertRow(id=f"overstock:{product.id}", kind="overstock", severity="info", product_id=str(product.id), product_name=product.name, detail=f"{coverage:.1f} months of stock", quantity=float(stock.get(product.id, 0) or 0)))
    for cert in db.scalars(select(Certificate).where(Certificate.valid_until.is_not(None), Certificate.valid_until <= today + timedelta(days=365))).all():
        result.append(AlertRow(id=f"certificate:{cert.id}", kind="certificate", severity="critical" if cert.valid_until <= today + timedelta(days=180) else "warning", product_name=cert.trade_name, detail=f"Certificate {cert.certificate_number}", date=cert.valid_until))
    order = {"critical": 0, "warning": 1, "info": 2}
    result.sort(key=lambda row: (order.get(row.severity, 9), row.date or date.max, row.product_name.casefold()))
    return result[:limit]


class RecommendationRow(BaseModel):
    product_id: str
    product_name: str
    project_name: Optional[str] = None
    manufacturer_label: Optional[str] = None
    avg_monthly_sales: float
    current_stock: float
    customs_stock: float
    incoming_stock: float
    open_orders: float
    coverage_months: Optional[float] = None
    target_months: int
    recommended_order: float


@router.get("/recommendations", response_model=list[RecommendationRow])
def recommendations(
    db: Session = Depends(get_db),
    target_months: int = Query(default=6, ge=1, le=24),
    limit: int = Query(default=300, ge=1, le=1000),
) -> list[RecommendationRow]:
    products = db.scalars(select(AnalyticsProduct).options(selectinload(AnalyticsProduct.project_rel))).all()
    ids = [p.id for p in products]
    current = _month_first(date.today())
    end = _add_months(current, -1)
    start = _add_months(end, -2)
    avg_ot = _series_avg(db, AnalyticsSales, ids, start, end) if ids else {}
    avg_fs = _series_avg(db, AnalyticsFactSales, ids, start, end) if ids else {}
    stock = {pid: float(qty or 0) for pid, qty in db.execute(select(WarehouseStock.product_id, func.sum(WarehouseStock.quantity)).group_by(WarehouseStock.product_id)).all()}
    lower_names = {p.name.casefold() for p in products}
    customs: dict[str, float] = {}
    incoming: dict[str, float] = {}
    for name, regime, qty in db.execute(select(func.lower(CustomsWarehouseProduct.product_name), CustomsWarehouseProduct.regime, func.sum(CustomsWarehouseProduct.qty)).where(func.lower(CustomsWarehouseProduct.product_name).in_(lower_names)).group_by(func.lower(CustomsWarehouseProduct.product_name), CustomsWarehouseProduct.regime)).all():
        bucket = incoming if regime in INCOMING_REGIMES else customs if regime in CUSTOMS_REGIMES else None
        if bucket is not None:
            bucket[name] = bucket.get(name, 0.0) + float(qty or 0)
    orders = {pid: float(qty or 0) for pid, qty in db.execute(select(AnalyticsOrders.analytics_product_id, func.sum(AnalyticsOrders.qty)).where(AnalyticsOrders.month >= current).group_by(AnalyticsOrders.analytics_product_id)).all()}
    received = {pid: float(qty or 0) for pid, qty in db.execute(select(AnalyticsReceived.analytics_product_id, func.sum(AnalyticsReceived.qty)).where(AnalyticsReceived.month >= current).group_by(AnalyticsReceived.analytics_product_id)).all()}
    result: list[RecommendationRow] = []
    for product in products:
        a = avg_ot.get(product.id, 0.0)
        b = avg_fs.get(product.id, 0.0)
        avg = (a + b) / 2 if a > 0 and b > 0 else (a or b)
        if avg <= 0:
            continue
        current_stock = stock.get(product.id, 0.0)
        custom = customs.get(product.name.casefold(), 0.0)
        transit = incoming.get(product.name.casefold(), 0.0)
        open_order = max(0.0, orders.get(product.id, 0.0) - received.get(product.id, 0.0))
        recommended = max(0.0, round(avg * target_months - current_stock - custom - transit - open_order))
        result.append(RecommendationRow(product_id=str(product.id), product_name=product.name, project_name=product.project_name, manufacturer_label=product.manufacturer_label, avg_monthly_sales=avg, current_stock=current_stock, customs_stock=custom, incoming_stock=transit, open_orders=open_order, coverage_months=current_stock / avg, target_months=target_months, recommended_order=recommended))
    result.sort(key=lambda row: (-row.recommended_order, row.coverage_months or 0, row.product_name.casefold()))
    return result[:limit]


class QualityIssue(BaseModel):
    id: str
    kind: str
    severity: str
    product_id: Optional[str] = None
    product_name: str
    detail: str


@router.get("/quality", response_model=list[QualityIssue])
def data_quality(db: Session = Depends(get_db)) -> list[QualityIssue]:
    products = db.scalars(select(AnalyticsProduct).options(selectinload(AnalyticsProduct.project_rel))).all()
    company = {pid: float(qty or 0) for pid, qty in db.execute(select(AnalyticsStockCompany.analytics_product_id, AnalyticsStockCompany.qty)).all()}
    warehouse = {pid: float(qty or 0) for pid, qty in db.execute(select(WarehouseStock.product_id, func.sum(WarehouseStock.quantity)).group_by(WarehouseStock.product_id)).all()}
    result: list[QualityIssue] = []
    for product in products:
        missing = [label for label, value in (("external code", product.external_id), ("project", product.project_name), ("manufacturer", product.manufacturer_label), ("category", product.catalog_category)) if not value]
        if missing:
            result.append(QualityIssue(id=f"catalog:{product.id}", kind="catalog", severity="warning", product_id=str(product.id), product_name=product.name, detail="Missing " + ", ".join(missing)))
        c, w = company.get(product.id, 0.0), warehouse.get(product.id, 0.0)
        if abs(c - w) > 0.01:
            result.append(QualityIssue(id=f"balance:{product.id}", kind="balance", severity="critical", product_id=str(product.id), product_name=product.name, detail=f"Company {c:g} vs warehouses {w:g}"))
        expiry_rows = rows_for_product(product)
        expiry_total = sum(float(row.get("quantity") or 0) for row in expiry_rows)
        if expiry_rows and abs(c - expiry_total) > 0.01:
            result.append(QualityIssue(id=f"expiry-balance:{product.id}", kind="expiry_balance", severity="critical", product_id=str(product.id), product_name=product.name, detail=f"Company {c:g} vs expiry snapshot {expiry_total:g}"))
    product_codes = {str(p.external_id or "").strip() for p in products if p.external_id}
    product_names = {normalize_product_name(p.name) for p in products}
    by_code, _by_name = indexes()
    for code, rows in by_code.items():
        name = str(rows[0].get("product_name") or "")
        if code not in product_codes and normalize_product_name(name) not in product_names:
            result.append(QualityIssue(id=f"expiry:{code}", kind="expiry_unmatched", severity="warning", product_name=name, detail=f"Expiry code {code} is not in the catalog"))
    unlinked = db.scalars(select(Certificate).where(~Certificate.product_links.any())).all()
    for cert in unlinked:
        result.append(QualityIssue(id=f"certificate:{cert.id}", kind="certificate", severity="warning", product_name=cert.trade_name, detail=f"Certificate {cert.certificate_number} has no product link"))
    result.sort(key=lambda issue: (0 if issue.severity == "critical" else 1, issue.kind, issue.product_name.casefold()))
    return result


class ProductDossier(BaseModel):
    product: dict
    company_stock: float
    warehouses: list[dict]
    expiries: list[dict]
    customs: list[dict]
    sales: list[dict]
    certificates: list[dict]


@router.get("/products/{product_id}", response_model=ProductDossier)
def product_dossier(product_id: str, db: Session = Depends(get_db)) -> ProductDossier:
    product = db.scalar(select(AnalyticsProduct).options(selectinload(AnalyticsProduct.project_rel)).where(AnalyticsProduct.id == product_id))
    if product is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found.")
    company_stock = db.scalar(select(AnalyticsStockCompany.qty).where(AnalyticsStockCompany.analytics_product_id == product.id)) or 0
    wh_rows = db.execute(select(Warehouse.name, Warehouse.code, WarehouseStock.quantity).join(WarehouseStock, WarehouseStock.warehouse_id == Warehouse.id).where(WarehouseStock.product_id == product.id, WarehouseStock.quantity != 0).order_by(Warehouse.name)).all()
    custom_rows = db.scalars(select(CustomsWarehouseProduct).options(selectinload(CustomsWarehouseProduct.series), selectinload(CustomsWarehouseProduct.invoice)).where(func.lower(CustomsWarehouseProduct.product_name) == product.name.lower())).all()
    dispatched = dict(db.execute(select(AnalyticsSales.month, func.sum(AnalyticsSales.qty)).where(AnalyticsSales.analytics_product_id == product.id).group_by(AnalyticsSales.month)).all())
    sold = dict(db.execute(select(AnalyticsFactSales.month, func.sum(AnalyticsFactSales.qty)).where(AnalyticsFactSales.analytics_product_id == product.id).group_by(AnalyticsFactSales.month)).all())
    months = sorted(set(dispatched) | set(sold))[-12:]
    certs = db.scalars(select(Certificate).join(CertificateProductLink).where(CertificateProductLink.product_id == product.id).order_by(Certificate.valid_until.asc().nulls_last())).all()
    return ProductDossier(
        product={"id": str(product.id), "name": product.name, "external_id": product.external_id, "project_name": product.project_name, "manufacturer_label": product.manufacturer_label, "category": product.catalog_category, "strength": product.strength, "dosage_form": product.dosage_form, "country": product.country},
        company_stock=float(company_stock),
        warehouses=[{"name": name, "code": code, "quantity": float(qty)} for name, code, qty in wh_rows],
        expiries=rows_for_product(product),
        customs=[{"id": str(row.id), "invoice": row.invoice.name, "regime": row.regime, "quantity": float(row.qty), "expiry_date": row.product_expiry, "series": [{"batch": series.batch, "quantity": float(series.qty)} for series in row.series]} for row in custom_rows],
        sales=[{"month": month, "dispatched": float(dispatched.get(month, 0) or 0), "sold": float(sold.get(month, 0) or 0)} for month in months],
        certificates=[{"id": str(cert.id), "number": cert.certificate_number, "valid_until": cert.valid_until, "trade_name": cert.trade_name, "has_document": bool(cert.document_storage_path)} for cert in certs],
    )


@router.get("/audit", response_model=list[dict])
def audit_events(request: Request, limit: int = Query(default=100, ge=1, le=500)) -> list[dict]:
    _require_admin(request)
    return recent_events(limit)
