#!/bin/sh
# SYNC web demo. Two processes:
#   1. read service  — sync-mirror backend on :8000 (needs backend/.env with OPENAI_API_KEY)
#   2. this page     — static server on :4173  →  http://localhost:4173
# Without the backend the page still works; the scan falls back to a labelled sample read.
cd "$(dirname "$0")"
( cd ../sync-mirror/backend && .venv/bin/python -m uvicorn main:app --port 8000 ) &
BACK=$!
trap 'kill $BACK 2>/dev/null' EXIT INT TERM
python3 -m http.server 4173 --directory web
