#!/usr/bin/env bash
# Render / container entrypoint: migrate, optionally seed demo data (only into an empty DB), serve.
set -euo pipefail
cd "$(dirname "$0")"
alembic upgrade head
if [ "${SEED_DEMO:-false}" = "true" ]; then
  python -m app.seed --demo
fi
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-4000}" --proxy-headers --forwarded-allow-ips='*'
