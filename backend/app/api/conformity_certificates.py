"""Marketing-owned workflow for official certificates of conformity."""
from __future__ import annotations

import json
from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import ConformityCertificate
from ..services.audit import record_event

router = APIRouter(prefix="/conformity-certificates", tags=["conformity-certificates"])
MAX_PDF_BYTES = 10 * 1024 * 1024


class ProductLine(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    batch: str | None = None
    expiry_date: date | None = None
    quantity: str | None = None
    hs_code: str | None = None

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Product name is required.")
        return value


class CertificateInput(BaseModel):
    certificate_number: str = Field(min_length=1, max_length=200)
    registration_date: date
    valid_until: date
    applicant: str = Field(min_length=1, max_length=500)
    manufacturer: str = Field(min_length=1, max_length=500)
    certifying_body: str | None = None
    notes: str | None = None
    product_lines: list[ProductLine] = Field(min_length=1)

    @field_validator("certificate_number", "applicant", "manufacturer")
    @classmethod
    def clean_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field is required.")
        return value

    @model_validator(mode="after")
    def check_dates(self):
        if self.valid_until < self.registration_date:
            raise ValueError("Valid-until date must be on or after registration date.")
        return self


class CertificateRead(CertificateInput):
    id: UUID
    document_name: str
    document_size_bytes: int
    archived: bool
    created_by: str
    updated_by: str
    created_at: datetime
    updated_at: datetime


class ArchiveInput(BaseModel):
    archived: bool


def _read(row: ConformityCertificate) -> CertificateRead:
    return CertificateRead(
        id=row.id, certificate_number=row.certificate_number,
        registration_date=row.registration_date, valid_until=row.valid_until,
        applicant=row.applicant, manufacturer=row.manufacturer,
        certifying_body=row.certifying_body, notes=row.notes,
        product_lines=[ProductLine.model_validate(line) for line in row.product_lines],
        document_name=row.document_name, document_size_bytes=row.document_size_bytes,
        archived=row.archived, created_by=row.created_by, updated_by=row.updated_by,
        created_at=row.created_at, updated_at=row.updated_at,
    )


def _require_editor(request: Request) -> str:
    if getattr(request.state, "user_role", None) not in ("admin", "sysadmin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Administrator access required.")
    return request.state.user_name


def _parse_payload(payload: str) -> CertificateInput:
    try:
        return CertificateInput.model_validate(json.loads(payload))
    except (ValueError, ValidationError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


async def _read_pdf(file: UploadFile) -> tuple[str, bytes]:
    name = (file.filename or "certificate.pdf").replace("\\", "/").split("/")[-1]
    if not name.lower().endswith(".pdf"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Upload a PDF document.")
    content = await file.read(MAX_PDF_BYTES + 1)
    if len(content) > MAX_PDF_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "PDF must be 10 MB or smaller.")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "File is not a PDF document.")
    return name, content


def _assign(row: ConformityCertificate, data: CertificateInput) -> None:
    row.certificate_number = data.certificate_number
    row.registration_date = data.registration_date
    row.valid_until = data.valid_until
    row.applicant = data.applicant
    row.manufacturer = data.manufacturer
    row.certifying_body = data.certifying_body.strip() or None if data.certifying_body else None
    row.notes = data.notes.strip() or None if data.notes else None
    row.product_lines = [line.model_dump(mode="json") for line in data.product_lines]


@router.get("", response_model=list[CertificateRead])
def list_certificates(db: Session = Depends(get_db)) -> list[CertificateRead]:
    rows = db.scalars(select(ConformityCertificate).order_by(ConformityCertificate.valid_until, ConformityCertificate.certificate_number)).all()
    return [_read(row) for row in rows]


@router.post("", response_model=CertificateRead, status_code=status.HTTP_201_CREATED)
async def create_certificate(
    request: Request, payload: str = Form(...), document: UploadFile = File(...), db: Session = Depends(get_db),
) -> CertificateRead:
    actor = _require_editor(request)
    data = _parse_payload(payload)
    name, content = await _read_pdf(document)
    existing = db.scalar(select(ConformityCertificate.id).where(ConformityCertificate.certificate_number == data.certificate_number))
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Certificate number already exists.")
    row = ConformityCertificate(
        document_name=name, document_mime_type="application/pdf",
        document_size_bytes=len(content), document_blob=content,
        created_by=actor, updated_by=actor,
    )
    _assign(row, data)
    db.add(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Certificate number already exists.") from exc
    db.refresh(row)
    record_event(actor=actor, action="conformity_certificate_created", target=str(row.id), details={"number": row.certificate_number})
    return _read(row)


@router.put("/{certificate_id}", response_model=CertificateRead)
async def update_certificate(
    certificate_id: UUID, request: Request, payload: str = Form(...),
    document: UploadFile | None = File(default=None), db: Session = Depends(get_db),
) -> CertificateRead:
    actor = _require_editor(request)
    row = db.get(ConformityCertificate, certificate_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Certificate not found.")
    data = _parse_payload(payload)
    existing = db.scalar(select(ConformityCertificate.id).where(
        ConformityCertificate.certificate_number == data.certificate_number,
        ConformityCertificate.id != certificate_id,
    ))
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Certificate number already exists.")
    _assign(row, data)
    if document is not None:
        name, content = await _read_pdf(document)
        row.document_name = name
        row.document_size_bytes = len(content)
        row.document_blob = content
    row.updated_by = actor
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Certificate number already exists.") from exc
    db.refresh(row)
    record_event(actor=actor, action="conformity_certificate_updated", target=str(row.id), details={"number": row.certificate_number})
    return _read(row)


@router.patch("/{certificate_id}/archive", response_model=CertificateRead)
def archive_certificate(certificate_id: UUID, payload: ArchiveInput, request: Request, db: Session = Depends(get_db)) -> CertificateRead:
    actor = _require_editor(request)
    row = db.get(ConformityCertificate, certificate_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Certificate not found.")
    row.archived = payload.archived
    row.updated_by = actor
    db.commit()
    db.refresh(row)
    record_event(actor=actor, action="conformity_certificate_archived" if row.archived else "conformity_certificate_restored", target=str(row.id), details={"number": row.certificate_number})
    return _read(row)


@router.get("/{certificate_id}/document")
def download_document(certificate_id: UUID, db: Session = Depends(get_db)) -> Response:
    row = db.get(ConformityCertificate, certificate_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Certificate not found.")
    return Response(
        content=row.document_blob, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{str(row.id)}.pdf"', "X-Content-Type-Options": "nosniff"},
    )
