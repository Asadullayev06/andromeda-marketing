from __future__ import annotations

import asyncio
from io import BytesIO
import unittest

from fastapi import HTTPException, UploadFile
from pydantic import ValidationError

from app.api.conformity_certificates import CertificateInput, _read_pdf


class ConformityCertificateTests(unittest.TestCase):
    def test_certificate_accepts_multiple_batches_and_requires_product(self) -> None:
        valid = {
            "product_lines": [{"name": "Cholready", "batches": [
                {"batch": "250100", "quantity": "24900 packages"},
                {"batch": "250700", "quantity": "24850 packages"},
            ]}],
        }
        product = CertificateInput.model_validate(valid).product_lines[0]
        self.assertEqual(product.name, "Cholready")
        self.assertEqual([batch.batch for batch in product.batches], ["250100", "250700"])
        with self.assertRaises(ValidationError):
            CertificateInput.model_validate({**valid, "product_lines": [{"name": "  "}]})
        with self.assertRaises(ValidationError):
            CertificateInput.model_validate({**valid, "product_lines": [{"name": "Cholready", "batches": []}]})

    def test_legacy_product_line_reads_as_one_batch(self) -> None:
        from app.api.conformity_certificates import ProductLine

        product = ProductLine.model_validate({
            "name": "Cholready", "batch": "250100", "expiry_date": "2028-12-16",
            "quantity": "24900 packages", "hs_code": "3004900002",
        })
        self.assertEqual(product.batches[0].batch, "250100")
        self.assertEqual(product.batches[0].quantity, "24900 packages")

    def test_upload_rejects_non_pdf_content(self) -> None:
        file = UploadFile(file=BytesIO(b"not a PDF"), filename="certificate.pdf")
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(_read_pdf(file))
        self.assertEqual(caught.exception.status_code, 422)
