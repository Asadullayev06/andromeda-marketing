from __future__ import annotations

import unittest

from app.config import settings


class StockEditorPolicyTests(unittest.TestCase):
    def test_sysadmin_is_always_editor(self) -> None:
        original = settings.stock_editor_users
        settings.stock_editor_users = "specific-admin"
        self.assertTrue(settings.can_edit_stock("sysadmin", "root"))
        settings.stock_editor_users = original

    def test_admin_allowlist(self) -> None:
        original = settings.stock_editor_users
        settings.stock_editor_users = "alice,bob"
        self.assertTrue(settings.can_edit_stock("admin", "Alice"))
        self.assertFalse(settings.can_edit_stock("admin", "charlie"))
        self.assertFalse(settings.can_edit_stock("guest", "alice"))
        settings.stock_editor_users = original
