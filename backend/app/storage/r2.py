"""Minimal read-only Cloudflare R2 client (S3-compatible via boto3).

This Sales app only ever *reads* objects that ANDROMEDA uploaded — it hands the
browser short-lived presigned GET URLs for customs certificate PDFs. It never
uploads or deletes, so there is no storage-outbox / GC involvement here.

Reads config from settings.r2_* and raises R2NotConfigured (mapped to 503) when
credentials are missing, so the app still runs in dev without R2 wired.
Secrets are only passed to boto3 — never logged or returned.
"""
from __future__ import annotations

try:
    import boto3
    from botocore.client import Config
    from botocore.exceptions import BotoCoreError, ClientError
except Exception:  # pragma: no cover — boto3 is in requirements.txt
    boto3 = None  # type: ignore[assignment]
    Config = None  # type: ignore[assignment]
    BotoCoreError = ClientError = Exception  # type: ignore[misc,assignment]

from ..config import settings


class R2NotConfigured(RuntimeError):
    """Raised when a document endpoint is called but R2_* env vars are unset."""


class R2Error(RuntimeError):
    """Raised for any storage-side failure (presign)."""


def _require_settings() -> None:
    missing = [
        name
        for name, val in (
            ("R2_ACCOUNT_ID", settings.r2_account_id),
            ("R2_ACCESS_KEY_ID", settings.r2_access_key_id),
            ("R2_SECRET_ACCESS_KEY", settings.r2_secret_access_key),
            ("R2_BUCKET", settings.r2_bucket),
            ("R2_ENDPOINT_URL", settings.r2_endpoint_url),
        )
        if not val
    ]
    if missing:
        raise R2NotConfigured(
            "R2 storage is not configured. Missing env var(s): " + ", ".join(missing) + "."
        )


def _client():
    if boto3 is None:  # pragma: no cover
        raise R2NotConfigured("boto3 is not installed (see requirements.txt).")
    _require_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def create_download_url(*, key: str, ttl_seconds: int = 300) -> str:
    """Return a presigned URL that grants short-lived GET access to the object."""
    try:
        return _client().generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": settings.r2_bucket, "Key": key},
            ExpiresIn=ttl_seconds,
        )
    except (BotoCoreError, ClientError) as exc:
        raise R2Error(f"R2 presign failed: {type(exc).__name__}") from exc
