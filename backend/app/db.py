"""SQLAlchemy engine + request-scoped session dependency.

Deliberately simpler than ANDROMEDA's db.py: no storage-outbox compensation,
no runtime-metrics instrumentation. This service only reads and lightly writes
the shared stock tables, so a plain session lifecycle is enough.
"""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from .config import settings


def _engine_options(database_url: str) -> dict[str, object]:
    options: dict[str, object] = {"pool_pre_ping": True, "future": True}
    if not database_url.startswith("sqlite"):
        options.update(
            connect_args={"connect_timeout": 10},
            pool_size=settings.database_pool_size,
            max_overflow=settings.database_max_overflow,
            pool_timeout=settings.database_pool_timeout_seconds,
            pool_recycle=settings.database_pool_recycle_seconds,
            pool_use_lifo=True,
        )
    return options


engine = create_engine(settings.database_url, **_engine_options(settings.database_url))


@event.listens_for(engine, "begin")
def _configure_connection_timeouts(connection) -> None:
    if settings.database_url.startswith("sqlite"):
        return
    connection.exec_driver_sql(
        f"SET LOCAL statement_timeout = {settings.database_statement_timeout_ms}"
    )


SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False,
    class_=Session,
)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
