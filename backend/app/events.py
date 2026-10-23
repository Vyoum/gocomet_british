"""In-process asyncio pub/sub used to push SSE updates.

When Redis is configured (REDIS_URL / CELERY_BROKER_URL), out-of-process publishers such as the Celery auto-close
worker publish to the Redis channel below, and each API process relays that channel into its local bus.
Without Redis, everything stays in-process exactly as before.
"""
import asyncio
import logging

from .config import redis_url

log = logging.getLogger("rfq.events")
CHANNEL = "rfq:events"


class EventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[str]] = set()

    def subscribe(self) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=1000)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[str]) -> None:
        self._subscribers.discard(q)

    def publish(self, rfq_id: str) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait(rfq_id)
            except asyncio.QueueFull:  # slow client: drop; it refetches on the next event anyway
                pass

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)


bus = EventBus()


def publish_external(rfq_id: str) -> bool:
    """Publish from a non-API process (Celery worker). No-op (returns False) when Redis is not configured."""
    url = redis_url()
    if not url:
        return False
    import redis

    try:
        with redis.Redis.from_url(url) as r:
            r.publish(CHANNEL, rfq_id)
        return True
    except Exception:  # clients still see the right status on their next refetch/poll
        log.warning("failed to publish %s to redis", rfq_id, exc_info=True)
        return False


async def redis_relay() -> None:
    """Forward Redis channel messages into the local bus; reconnects with backoff. Runs only when Redis is set."""
    import redis.asyncio as aioredis

    delay = 1.0
    while True:
        try:
            r = aioredis.Redis.from_url(redis_url())
            async with r.pubsub() as ps:
                await ps.subscribe(CHANNEL)
                delay = 1.0
                async for m in ps.listen():
                    if m.get("type") == "message":
                        data = m["data"]
                        bus.publish(data.decode() if isinstance(data, bytes) else str(data))
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning("redis relay disconnected; retrying in %.0fs", delay, exc_info=True)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30)
