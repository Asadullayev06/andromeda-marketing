from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
import json
from pathlib import Path
import re

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from ..config import settings

_cached_mtime_ns: int | None = None
_cached_payload: dict | None = None
_cached_index_payload: dict | None = None
_cached_indexes: tuple[dict[str, list[dict]], dict[str, list[dict]]] | None = None


def normalize_product_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().casefold())


def snapshot_path() -> Path:
    return settings.data_dir / "company_stock_expiries.json"


def _payload() -> dict:
    global _cached_mtime_ns, _cached_payload
    path = snapshot_path()
    if not path.exists():
        path = Path(__file__).resolve().parent.parent / "data" / "company_stock_expiries.json"
    stat = path.stat()
    if _cached_payload is None or _cached_mtime_ns != stat.st_mtime_ns:
        _cached_payload = json.loads(path.read_text(encoding="utf-8"))
        _cached_mtime_ns = stat.st_mtime_ns
    return _cached_payload


def _live_payload(db: Session) -> dict | None:
    """Use the shared Smartup snapshot after its first successful apply.

    Cache within this request's session so list/report endpoints do not issue
    one query per catalog product. An unsynced warehouse contributes no rows.
    """
    if "smartup_expiry_payload" in db.info:
        return db.info["smartup_expiry_payload"]
    if not inspect(db.connection()).has_table("smartup_stock_snapshot_warehouses"):
        db.info["smartup_expiry_payload"] = None
        return None
    markers = db.execute(text("SELECT count(*), max(as_of), min(as_of), max(synced_at) FROM smartup_stock_snapshot_warehouses")).one()
    if not markers[0]:
        db.info["smartup_expiry_payload"] = None
        return None
    # Older shared schemas have no card_code yet. Show an unknown card there
    # rather than presenting Smartup's unrelated batch_number as a card.
    has_card_code = any(column["name"] == "card_code" for column in
                        inspect(db.connection()).get_columns("smartup_stock_batch_rows"))
    card_column = "b.card_code" if has_card_code else "NULL"
    rows = db.execute(text(f"""
        SELECT p.external_id, p.name, b.expiry_date, {card_column}, b.quantity
        FROM smartup_stock_batch_rows b
        JOIN analytics_products p ON p.id = b.product_id
        WHERE b.quantity > 0
    """)).all()
    aggregate: defaultdict[tuple[str, str, str | None, str | None], Decimal] = defaultdict(Decimal)
    for code, name, expiry, card_code, quantity in rows:
        aggregate[(str(code or "").strip(), name, str(expiry)[:10] if expiry else None, card_code)] += Decimal(str(quantity))
    synced_products = db.execute(text("""
        SELECT p.external_id, p.name FROM analytics_products p
        WHERE p.project_id IN (
            SELECT DISTINCT w.project_id FROM warehouses w
            JOIN smartup_stock_snapshot_warehouses s ON s.warehouse_id = w.id
            WHERE w.project_id IS NOT NULL
        )
        OR lower(trim(coalesce(p.product_group, ''))) IN (
            SELECT DISTINCT lower(trim(pr.name)) FROM projects pr
            JOIN warehouses w ON w.project_id = pr.id
            JOIN smartup_stock_snapshot_warehouses s ON s.warehouse_id = w.id
        )
    """)).all()
    synced_codes = {str(code).strip() for code, _ in synced_products if code}
    synced_names = {normalize_product_name(name) for _, name in synced_products}
    legacy = _payload()
    legacy_items = [row for row in legacy.get("items", [])
                    if str(row.get("product_code") or "").strip() not in synced_codes
                    and normalize_product_name(str(row.get("product_name") or "")) not in synced_names]
    # Preserve the existing response key used by imported Excel snapshots and
    # current API clients; for live Smartup rows its value is the card code.
    live_items = [{"product_code": code, "product_name": name, "expiry_date": expiry,
                   "batch_number": card_code, "quantity": float(quantity)}
                  for (code, name, expiry, card_code), quantity in aggregate.items()]
    live_date = str(markers[1])[:10]
    oldest_date = str(markers[2])[:10]
    if legacy_items:
        oldest_date = min(oldest_date, str(legacy.get("imported_at"))[:10])
    payload = {
        "source": f"Smartup sync ({markers[0]} warehouses)" + (" + legacy file for unsynced projects" if legacy_items else ""),
        "imported_at": live_date,
        "oldest_as_of": oldest_date,
        "imported_at_utc": str(markers[3]) if markers[3] else None,
        "raw_row_count": len(rows) + len(legacy_items),
        "items": live_items + legacy_items,
        "synced_product_codes": synced_codes,
        "synced_product_names": synced_names,
        "has_legacy_items": bool(legacy_items),
    }
    db.info["smartup_expiry_payload"] = payload
    return payload


def _current_payload(db: Session | None) -> dict:
    return (_live_payload(db) if db is not None else None) or _payload()


def snapshot_info(db: Session | None = None) -> dict:
    payload = _current_payload(db)
    items = payload.get("items", [])
    products = {(str(row.get("product_code") or ""), normalize_product_name(str(row.get("product_name") or ""))) for row in items}
    imported_at = date.fromisoformat(payload.get("imported_at"))
    age_days = max(0, (date.today() - date.fromisoformat(payload.get("oldest_as_of", imported_at.isoformat()))).days)
    return {
        "source": payload.get("source", "Smartup stock detail export"),
        "imported_at": payload.get("imported_at"),
        "row_count": int(payload.get("raw_row_count") or len(items)),
        "aggregated_row_count": len(items),
        "product_count": len(products),
        "total_quantity": sum(float(row.get("quantity") or 0) for row in items),
        "age_days": age_days,
        "is_stale": age_days > 7,
    }


def indexes(db: Session | None = None) -> tuple[dict[str, list[dict]], dict[str, list[dict]]]:
    global _cached_index_payload, _cached_indexes
    payload = _current_payload(db)
    if _cached_indexes is not None and _cached_index_payload is payload:
        return _cached_indexes
    by_code: dict[str, list[dict]] = {}
    by_name: dict[str, list[dict]] = {}
    for row in payload.get("items", []):
        code = str(row.get("product_code") or "").strip()
        name = normalize_product_name(str(row.get("product_name") or ""))
        if code:
            by_code.setdefault(code, []).append(row)
        if name:
            by_name.setdefault(name, []).append(row)
    _cached_index_payload = payload
    _cached_indexes = (by_code, by_name)
    return _cached_indexes


def rows_for_product(product, db: Session | None = None) -> list[dict]:
    by_code, by_name = indexes(db)
    code = str(product.external_id or "").strip()
    if code and code in by_code:
        return by_code[code]
    return by_name.get(normalize_product_name(product.name), [])
