"""In-process asyncio pub/sub used to push SSE updates. Swap for Redis pub/sub when scaling horizontally."""
import asyncio


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
