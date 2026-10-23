"""Optional Celery app: periodic auto-close of auctions.

Enabled only when REDIS_URL or CELERY_BROKER_URL is set. Run:
    celery -A app.worker worker --loglevel=info
    celery -A app.worker beat --loglevel=info
The API does not import this module and works without it (status is computed on read).
"""
import asyncio
import logging

from celery import Celery
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from .closer import close_due_auctions
from .config import close_sweep_seconds, database_url, redis_url
from .events import publish_external

log = logging.getLogger("rfq.worker")

_broker = redis_url() or "memory://"  # memory:// lets tests import/call the task without Redis
celery_app = Celery("rfq", broker=_broker, backend=None)
celery_app.conf.update(
    task_ignore_result=True,
    timezone="UTC",
    beat_schedule={
        "close-due-auctions": {"task": "rfq.close_due_auctions", "schedule": close_sweep_seconds()},
    },
    # A sweep is cheap and idempotent; drop stale queued sweeps instead of piling them up.
    task_default_expires=max(close_sweep_seconds() * 2, 30),
    broker_connection_retry_on_startup=True,
)


async def _run() -> list[str]:
    # Fresh engine per run: each Celery task runs its own event loop via asyncio.run.
    engine = create_async_engine(database_url(), poolclass=NullPool)
    try:
        return await close_due_auctions(async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession))
    finally:
        await engine.dispose()


@celery_app.task(name="rfq.close_due_auctions")
def close_due_auctions_task() -> list[str]:
    ids = asyncio.run(_run())
    for rfq_id in ids:
        publish_external(rfq_id)
    if ids:
        log.info("closed %d auction(s): %s", len(ids), ids)
    return ids
