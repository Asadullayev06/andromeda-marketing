from __future__ import annotations

import asyncio
from io import BytesIO
import unittest

from fastapi import HTTPException, UploadFile
from pydantic import ValidationError

from app.api.conformity_certificates import CertificateInput, _read_pdf


class ConformityCertificateTests(unittest.TestCase):
    def test_certificate_requires_a_valid_date_range_and_product(self) -> None:
        valid = {
            "certificate_number": "UZ.SMT-01-0105-186819",
            "registration_date": "2026-04-01",
            "valid_until": "2028-12-16",
            "applicant": "SYNERGY PHARMCO",
            "manufacturer": "UNIMED",
            "product_lines": [{"name": "Cholready", "batch": "250100", "quantity": "24900 packages"}],
        }
        self.assertEqual(CertificateInput.model_validate(valid).product_lines[0].name, "Cholready")
        with self.assertRaises(ValidationError):
            CertificateInput.model_validate({**valid, "valid_until": "2026-03-31"})
        with self.assertRaises(ValidationError):
            CertificateInput.model_validate({**valid, "product_lines": [{"name": "  "}]})

    def test_upload_rejects_non_pdf_content(self) -> None:
        file = UploadFile(file=BytesIO(b"not a PDF"), filename="certificate.pdf")
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(_read_pdf(file))
        self.assertEqual(caught.exception.status_code, 422)
