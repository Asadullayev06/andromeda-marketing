from __future__ import annotations

from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException

from app.api.customs import get_clearance_document_url


class _Session:
    def __init__(self, user, document):
        self.user = user
        self.document = document

    def scalar(self, _statement):
        return self.user

    def get(self, _model, _document_id):
        return self.document


class ClearanceDocumentAccessTests(TestCase):
    def test_only_named_recipient_gets_a_download_url(self):
        recipient = SimpleNamespace(id=uuid4())
        other = SimpleNamespace(id=uuid4())
        document = SimpleNamespace(storage_path="private/test.pdf", recipient_user_ids=[recipient.id])
        request = SimpleNamespace(state=SimpleNamespace(user_name="someone"))

        with patch("app.api.customs.r2.create_download_url", return_value="https://signed.example/file") as sign:
            with self.assertRaises(HTTPException) as denied:
                get_clearance_document_url(uuid4(), request, _Session(other, document))
            self.assertEqual(denied.exception.status_code, 404)
            sign.assert_not_called()

            result = get_clearance_document_url(uuid4(), request, _Session(recipient, document))
            self.assertEqual(result.url, "https://signed.example/file")
            sign.assert_called_once()

    def test_missing_document_is_not_disclosed(self):
        request = SimpleNamespace(state=SimpleNamespace(user_name="someone"))
        with self.assertRaises(HTTPException) as denied:
            get_clearance_document_url(uuid4(), request, _Session(SimpleNamespace(id=uuid4()), None))
        self.assertEqual(denied.exception.status_code, 404)

    def test_everyone_document_allows_any_signed_in_user(self):
        document = SimpleNamespace(storage_path="private/shared.pdf", recipient_user_ids=[])
        request = SimpleNamespace(state=SimpleNamespace(user_name="someone"))
        with patch("app.api.customs.r2.create_download_url", return_value="https://signed.example/shared"):
            result = get_clearance_document_url(uuid4(), request, _Session(SimpleNamespace(id=uuid4()), document))
        self.assertEqual(result.url, "https://signed.example/shared")

        request.state.user_name = None
        with self.assertRaises(HTTPException) as denied:
            get_clearance_document_url(uuid4(), request, _Session(None, document))
        self.assertEqual(denied.exception.status_code, 404)
