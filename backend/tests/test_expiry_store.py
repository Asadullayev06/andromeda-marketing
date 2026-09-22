from __future__ import annotations

from io import BytesIO
from pathlib import Path
import unittest

from openpyxl import Workbook

from app.config import settings
from app.services.expiry_store import import_workbook, normalize_product_name, snapshot_info


def workbook_bytes() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["Warehouse", "Code", "Product", "Expiry", "Batch", "Available"])
    sheet.append(["Central", "101", "Product A", "31.01.2028", "B1", 3])
    sheet.append(["Central", "101", "Product A", "31.01.2028", "B1", 2])
    sheet.append(["Central", "101", "Product A", "01.08.2028", "B2", 7])
    stream = BytesIO()
    workbook.save(stream)
    return stream.getvalue()


class ExpiryStoreTests(unittest.TestCase):
    def test_normalizes_names(self) -> None:
        self.assertEqual(normalize_product_name("  Product   A "), "product a")

    def test_import_aggregates_duplicate_batches(self) -> None:
        original = settings.marketing_data_dir
        fixture_dir = Path(__file__).resolve().parent / "fixtures"
        output = fixture_dir / "company_stock_expiries.json"
        try:
            settings.marketing_data_dir = str(fixture_dir)
            result = import_workbook(workbook_bytes(), "stock.xlsx")
            self.assertEqual(result["row_count"], 3)
            self.assertEqual(result["aggregated_row_count"], 2)
            self.assertEqual(result["product_count"], 1)
            self.assertEqual(result["total_quantity"], 12)
            self.assertEqual(snapshot_info()["source"], "stock.xlsx")
        finally:
            settings.marketing_data_dir = original
            output.unlink(missing_ok=True)

    def test_rejects_wrong_file_type(self) -> None:
        with self.assertRaisesRegex(ValueError, "Only .xlsx"):
            import_workbook(b"bad", "stock.csv")


if __name__ == "__main__":
    unittest.main()
