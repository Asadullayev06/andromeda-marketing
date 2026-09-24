from __future__ import annotations

from datetime import date
import unittest

from app.api.operations import AlertRow


class AlertRowTests(unittest.TestCase):
    def test_expiry_alert_accepts_date(self) -> None:
        expiry = date(2026, 9, 1)
        row = AlertRow(
            id="expiry:product:0",
            kind="expiry",
            severity="critical",
            product_name="Product",
            detail="Expired",
            date=expiry,
        )
        self.assertEqual(row.date, expiry)
        self.assertEqual(row.model_dump(mode="json")["date"], "2026-09-01")

    def test_stock_alert_allows_no_date(self) -> None:
        row = AlertRow(
            id="stock:product",
            kind="low_stock",
            severity="warning",
            product_name="Product",
            detail="1.5 months of stock",
        )
        self.assertIsNone(row.date)
