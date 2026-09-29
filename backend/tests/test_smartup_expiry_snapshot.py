"""Marketing reads the applied shared Smartup batch snapshot."""
from datetime import date
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.services.expiry_store import rows_for_product, snapshot_info


class SmartupExpirySnapshotTests(unittest.TestCase):
    def test_aggregates_batches_across_synced_warehouses(self):
        engine = create_engine("sqlite://")
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE projects (id text PRIMARY KEY, name text)"))
            connection.execute(text("CREATE TABLE warehouses (id text PRIMARY KEY, project_id text)"))
            connection.execute(text("CREATE TABLE analytics_products (id text PRIMARY KEY, external_id text, name text, project_id text, product_group text)"))
            connection.execute(text("CREATE TABLE smartup_stock_snapshot_warehouses (warehouse_id text PRIMARY KEY, as_of date, synced_at text)"))
            connection.execute(text("CREATE TABLE smartup_stock_batch_rows (warehouse_id text, product_id text, batch_number text, expiry_date date, quantity numeric)"))
            connection.execute(text("INSERT INTO projects VALUES ('amare', 'Amare'), ('referans', 'Referans')"))
            connection.execute(text("INSERT INTO warehouses VALUES ('a', 'amare'), ('b', 'amare'), ('c', 'referans')"))
            connection.execute(text("INSERT INTO analytics_products VALUES ('p1', '001', 'First', 'amare', 'Amare'), ('p2', '002', 'Second', 'referans', 'Referans')"))
            connection.execute(text("INSERT INTO smartup_stock_snapshot_warehouses VALUES ('a', '2026-09-29', '2026-09-29'), ('b', '2026-09-29', '2026-09-29')"))
            connection.execute(text("INSERT INTO smartup_stock_batch_rows VALUES ('a', 'p1', 'LOT-1', '2028-06-01', 3), ('b', 'p1', 'LOT-1', '2028-06-01', 4), ('b', 'p1', 'LOT-2', NULL, 2)"))
        legacy = {"imported_at": "2026-09-28", "items": [
            {"product_code": "001", "product_name": "First", "expiry_date": "2027-01-01", "batch_number": "STALE", "quantity": 100.0},
            {"product_code": "002", "product_name": "Second", "expiry_date": "2028-01-01", "batch_number": "LEGACY", "quantity": 5.0},
        ]}
        with Session(engine) as db, patch("app.services.expiry_store._payload", return_value=legacy):
            product = SimpleNamespace(external_id="001", name="First")
            self.assertEqual(rows_for_product(product, db), [
                {"product_code": "001", "product_name": "First", "expiry_date": "2028-06-01", "batch_number": "LOT-1", "quantity": 7.0},
                {"product_code": "001", "product_name": "First", "expiry_date": None, "batch_number": "LOT-2", "quantity": 2.0},
            ])
            self.assertEqual(rows_for_product(SimpleNamespace(external_id="002", name="Second"), db), [legacy["items"][1]])
            info = snapshot_info(db)
            self.assertEqual(info["product_count"], 2)
            self.assertEqual(info["total_quantity"], 14)
            self.assertEqual(info["imported_at"], date(2026, 9, 29).isoformat())
            self.assertIn("2 warehouses", info["source"])
            self.assertIn("legacy file", info["source"])
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
