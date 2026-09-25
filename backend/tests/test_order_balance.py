from __future__ import annotations

from datetime import date
from decimal import Decimal
import unittest
from uuid import uuid4

from app.services.order_balance import calculate_order_balances


class OrderBalanceTests(unittest.TestCase):
    def test_receipts_before_open_order_and_closed_orders_do_not_reduce_it(self) -> None:
        product_id = uuid4()
        march = date(2026, 3, 1)
        july = date(2026, 7, 1)
        balances = calculate_order_balances(
            [(product_id, march, Decimal("60000"), True),
             (product_id, july, Decimal("80000"), False)],
            [(product_id, date(2026, 2, 1), Decimal("12663")),
             (product_id, march, Decimal("40015")),
             (product_id, date(2026, 8, 1), Decimal("25515"))],
        )
        self.assertEqual(balances.by_order[(product_id, march)], 0)
        self.assertEqual(balances.by_order[(product_id, july)], Decimal("54485"))
        self.assertEqual(balances.by_product[product_id], Decimal("54485"))

    def test_receipts_use_oldest_order_then_close_at_ninety_percent(self) -> None:
        product_id = uuid4()
        january = date(2026, 1, 1)
        february = date(2026, 2, 1)
        balances = calculate_order_balances(
            [(product_id, january, Decimal("100"), False),
             (product_id, february, Decimal("100"), False)],
            [(product_id, january, Decimal("90")),
             (product_id, date(2026, 3, 1), Decimal("40"))],
        )
        self.assertEqual(balances.by_order[(product_id, january)], 0)
        self.assertEqual(balances.by_order[(product_id, february)], Decimal("60"))
        self.assertEqual(balances.by_product[product_id], Decimal("60"))
