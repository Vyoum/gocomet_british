import os
import subprocess
import sys
from pathlib import Path

import psycopg
import pytest

TEST_URL = os.environ.get("TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/rfq_test")
os.environ["DATABASE_URL"] = TEST_URL
os.environ["DB_NULLPOOL"] = "1"
BACKEND = Path(__file__).resolve().parents[1]


def _admin_url(url: str) -> tuple[str, str]:
    base, name = url.rsplit("/", 1)
    return base + "/postgres", name


@pytest.fixture(scope="session")
def migrated_db():
    admin, name = _admin_url(TEST_URL)
    with psycopg.connect(admin, autocommit=True) as c:
        c.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        c.execute(f'CREATE DATABASE "{name}"')
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, check=True, env={**os.environ})
    return TEST_URL


@pytest.fixture
def clean_db(migrated_db):
    with psycopg.connect(migrated_db, autocommit=True) as c:
        c.execute('TRUNCATE "ActivityLog", "Bid", "Rfq", "Supplier" CASCADE')
    return migrated_db


@pytest.fixture
async def client(clean_db):
    import httpx

    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c
