"""Expiry snapshots remain readable without a manual upload path."""
import unittest

from app.api.operations import router
from app.services.expiry_store import normalize_product_name


class ExpiryStoreTests(unittest.TestCase):
    def test_normalizes_names(self) -> None:
        self.assertEqual(normalize_product_name("  Product   A "), "product a")

    def test_manual_import_route_is_removed(self) -> None:
        paths = {(route.path, method) for route in router.routes
                 for method in getattr(route, "methods", set())}
        self.assertNotIn(("/operations/expiry/import", "POST"), paths)
        self.assertIn(("/operations/expiry/status", "GET"), paths)


if __name__ == "__main__":
    unittest.main()
