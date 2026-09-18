"""Enums bound to EXISTING Postgres enum types (never re-created here)."""
from __future__ import annotations

from enum import Enum


class UserRole(str, Enum):
    """Mirror of ANDROMEDA's `user_role` Postgres enum.

    sysadmin ⊇ admin ⊇ guest. Guests are read-only; admins may write business
    data; sysadmins additionally manage accounts (not exposed in this app).
    """

    sysadmin = "sysadmin"
    admin = "admin"
    guest = "guest"


class SupplierKind(str, Enum):
    """Mirror of ANDROMEDA's `supplier_kind` Postgres enum."""

    Manufacturer = "Manufacturer"
    Contragent = "Contragent"
    Logistics = "Logistics"
