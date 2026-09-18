#!/usr/bin/env bash
# Local dev server for the ANDROMEDA Sales backend.
set -euo pipefail
cd "$(dirname "$0")"
exec python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8010
