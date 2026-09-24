"""Product catalog + filter lookups (manufacturers, projects)."""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..enums import SupplierKind
from ..models import AnalyticsProduct, Project, Supplier

router = APIRouter(prefix="/catalog", tags=["catalog"])


class ProductRow(BaseModel):
    id: str
    name: str
    external_id: Optional[str] = None
    product_group: Optional[str] = None
    project_id: Optional[str] = None
    project_name: Optional[str] = None
    manufacturer_label: Optional[str] = None
    strength: Optional[str] = None
    dosage_form: Optional[str] = None
    country: Optional[str] = None
    catalog_category: Optional[str] = None


class ProductPage(BaseModel):
    items: list[ProductRow]
    total: int
    page: int
    page_size: int


def _row(p: AnalyticsProduct) -> ProductRow:
    return ProductRow(
        id=str(p.id),
        name=p.name,
        external_id=p.external_id,
        product_group=p.product_group,
        project_id=str(p.project_id) if p.project_id else None,
        project_name=p.project_name,
        manufacturer_label=p.manufacturer_label,
        strength=p.strength,
        dosage_form=p.dosage_form,
        country=p.country,
        catalog_category=p.catalog_category,
    )


@router.get("/products", response_model=ProductPage)
def list_products(
    db: Session = Depends(get_db),
    q: Optional[str] = Query(default=None),
    manufacturer: Optional[str] = Query(default=None),
    project_id: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    sort_by: Literal["name", "manufacturer", "project", "category", "country"] = Query(default="name"),
    sort_dir: Literal["asc", "desc"] = Query(default="asc"),
) -> ProductPage:
    stmt = select(AnalyticsProduct).options(selectinload(AnalyticsProduct.project_rel))
    count_stmt = select(func.count()).select_from(AnalyticsProduct)

    if q:
        like = f"%{q.strip()}%"
        cond = AnalyticsProduct.name.ilike(like)
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)
    if manufacturer:
        cond = AnalyticsProduct.manufacturer_label == manufacturer
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)
    if project_id:
        cond = AnalyticsProduct.project_id == project_id
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)
    if category:
        cond = AnalyticsProduct.catalog_category == category
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)

    total = db.scalar(count_stmt) or 0
    columns = {
        "name": AnalyticsProduct.name,
        "manufacturer": AnalyticsProduct.manufacturer_label,
        "project": func.coalesce(Project.name, AnalyticsProduct.product_group),
        "category": AnalyticsProduct.catalog_category,
        "country": AnalyticsProduct.country,
    }
    if sort_by == "project":
        stmt = stmt.outerjoin(Project, Project.id == AnalyticsProduct.project_id)
    column = func.lower(columns[sort_by])
    order = column.desc() if sort_dir == "desc" else column.asc()
    rows = db.scalars(
        stmt.order_by(order.nulls_last(), AnalyticsProduct.id)
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    return ProductPage(
        items=[_row(p) for p in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


class LookupResponse(BaseModel):
    manufacturers: list[str]
    projects: list[dict]
    categories: list[str]


@router.get("/lookups", response_model=LookupResponse)
def lookups(db: Session = Depends(get_db)) -> LookupResponse:
    """Filter options for the Sales UI: canonical manufacturers, projects, and
    the distinct product categories that actually appear in the catalog."""
    manufacturers = db.scalars(
        select(Supplier.name)
        .where(Supplier.supplier_kind == SupplierKind.Manufacturer)
        .order_by(Supplier.name)
    ).all()
    projects = db.scalars(
        select(Project).where(Project.is_active.is_(True)).order_by(Project.name)
    ).all()
    categories = db.scalars(
        select(AnalyticsProduct.catalog_category)
        .where(AnalyticsProduct.catalog_category.is_not(None))
        .distinct()
        .order_by(AnalyticsProduct.catalog_category)
    ).all()
    return LookupResponse(
        manufacturers=list(manufacturers),
        projects=[{"id": str(p.id), "name": p.name} for p in projects],
        categories=list(categories),
    )
