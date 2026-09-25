"""Read-only order balances shared by Marketing's order and stock views.

Receipts apply to the oldest still-open order for a product, starting in the
order month. A manually closed order and the final tail after 90% receipt no
longer count as expected stock. This mirrors ANDROMEDA's analytics calculation.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Iterable
from uuid import UUID

from sqlalchemy import Date, Numeric, Text, column, or_, select, table
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Session

from ..models import AnalyticsOrders, AnalyticsReceived


ORDER_CLOSE_THRESHOLD = Decimal("0.9")
RECEIPT_BACKFILL_NOTE = "Generated from existing Analytics received rows."

# These are read-only projections of tables owned by ANDROMEDA. Keeping them
# outside Base.metadata prevents Marketing from claiming their schema.
_invoices = table(
    "supplier_invoices",
    column("id", PgUUID(as_uuid=True)),
    column("invoice_date", Date),
    column("notes", Text),
)
_invoice_lines = table(
    "supplier_invoice_lines",
    column("invoice_id", PgUUID(as_uuid=True)),
    column("analytics_product_id", PgUUID(as_uuid=True)),
    column("paid_qty", Numeric(14, 4)),
    column("bonus_qty", Numeric(14, 4)),
)


@dataclass(frozen=True)
class OrderBalances:
    by_order: dict[tuple[UUID, date], Decimal]
    by_product: dict[UUID, Decimal]


def _month(value: date) -> date:
    return date(value.year, value.month, 1)


def calculate_order_balances(
    orders: Iterable[tuple[UUID, date, Decimal, bool]],
    receipts: Iterable[tuple[UUID, date, Decimal]],
) -> OrderBalances:
    """Allocate physical receipts across each product's orders oldest first."""
    month_facts: dict[UUID, dict[date, dict[str, Decimal | bool]]] = defaultdict(dict)

    def facts_for(product_id: UUID, month: date) -> dict[str, Decimal | bool]:
        return month_facts[product_id].setdefault(
            _month(month), {"ordered": Decimal(0), "received": Decimal(0), "closed": False},
        )

    for product_id, month, qty, is_closed in orders:
        facts = facts_for(product_id, month)
        facts["ordered"] += Decimal(qty)
        facts["closed"] = bool(facts["closed"] or is_closed)
    for product_id, month, qty in receipts:
        facts_for(product_id, month)["received"] += Decimal(qty)

    by_order: dict[tuple[UUID, date], Decimal] = {}
    by_product: dict[UUID, Decimal] = {}
    for product_id, months in month_facts.items():
        active: list[dict[str, Decimal | date]] = []
        for month, facts in sorted(months.items()):
            ordered = Decimal(facts["ordered"])
            if ordered > 0:
                by_order[(product_id, month)] = Decimal(0)
                if not facts["closed"]:
                    active.append({"month": month, "ordered": ordered, "remaining": ordered})
            receipt = max(Decimal(0), Decimal(facts["received"]))
            for order in active:
                if receipt <= 0:
                    break
                remaining = Decimal(order["remaining"])
                if remaining <= 0:
                    continue
                applied = min(remaining, receipt)
                remaining -= applied
                receipt -= applied
                if order["ordered"] - remaining >= order["ordered"] * ORDER_CLOSE_THRESHOLD:
                    remaining = Decimal(0)
                order["remaining"] = remaining
        total = Decimal(0)
        for order in active:
            remaining = Decimal(order["remaining"])
            by_order[(product_id, order["month"])] = remaining
            total += remaining
        by_product[product_id] = total
    return OrderBalances(by_order=by_order, by_product=by_product)


def load_order_balances(db: Session, product_ids: Iterable[UUID]) -> OrderBalances:
    ids = list(set(product_ids))
    if not ids:
        return OrderBalances(by_order={}, by_product={})
    orders = db.execute(
        select(AnalyticsOrders.analytics_product_id, AnalyticsOrders.month, AnalyticsOrders.qty, AnalyticsOrders.is_closed)
        .where(AnalyticsOrders.analytics_product_id.in_(ids))
    ).all()
    receipts = list(db.execute(
        select(AnalyticsReceived.analytics_product_id, AnalyticsReceived.month, AnalyticsReceived.qty)
        .where(AnalyticsReceived.analytics_product_id.in_(ids))
    ).all())
    invoice_receipts = db.execute(
        select(
            _invoice_lines.c.analytics_product_id,
            _invoices.c.invoice_date,
            _invoice_lines.c.paid_qty,
            _invoice_lines.c.bonus_qty,
        )
        .select_from(_invoice_lines.join(_invoices, _invoice_lines.c.invoice_id == _invoices.c.id))
        .where(
            _invoice_lines.c.analytics_product_id.in_(ids),
            or_(_invoices.c.notes.is_(None), _invoices.c.notes != RECEIPT_BACKFILL_NOTE),
        )
    ).all()
    receipts.extend(
        (product_id, invoice_date, Decimal(paid or 0) + Decimal(bonus or 0))
        for product_id, invoice_date, paid, bonus in invoice_receipts
    )
    return calculate_order_balances(orders, receipts)
