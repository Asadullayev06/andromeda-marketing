"""Register every mapped table on Base.metadata by importing them here.

All of these map EXISTING tables owned by ANDROMEDA migrations. This package
never emits DDL.
"""
from __future__ import annotations

from .base import Base
from .user import User
from .project import Project
from .supplier import Supplier
from .analytics import (
    AnalyticsProduct,
    AnalyticsSales,
    AnalyticsFactSales,
    AnalyticsOrders,
    AnalyticsReceived,
    AnalyticsStockCompany,
)
from .warehouse import Warehouse, WarehouseStock
from .customs_warehouse import (
    CustomsWarehouseInvoice,
    CustomsWarehouseProduct,
    CustomsWarehouseSeries,
    CustomsWarehouseClearance,
)
from .certificate import Certificate, CertificateProductLink
from .conformity_certificate import ConformityCertificate

__all__ = [
    "Base",
    "User",
    "Project",
    "Supplier",
    "AnalyticsProduct",
    "AnalyticsSales",
    "AnalyticsFactSales",
    "AnalyticsOrders",
    "AnalyticsReceived",
    "AnalyticsStockCompany",
    "Warehouse",
    "WarehouseStock",
    "CustomsWarehouseInvoice",
    "CustomsWarehouseProduct",
    "CustomsWarehouseSeries",
    "CustomsWarehouseClearance",
    "Certificate",
    "CertificateProductLink",
    "ConformityCertificate",
]
