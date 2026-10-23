"""Auto-close sweep: persist CLOSED / FORCE_CLOSED for auctions whose (current) close time has passed.

Purely additive: API status is still computed from the times on every read, so the app is correct with or
without this job. The job just records the transition (activity log + closedStatus) and pushes an update.
Idempotent: rows are claimed with FOR UPDATE SKIP LOCKED and only while closedStatus IS NULL, so repeated or
concurrent runs never log twice. Lock order matches place_bid (RFQ row), so a racing bid either commits first
(and may extend, making the RFQ no longer due) or sees the closed time and is rejected.
"""
import json
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .auction import get_status
from .models import ActivityLog, Rfq
from .serialize import iso


def _fmt(d: datetime) -> str:
    return iso(d).replace("T", " ")[:19] + "Z"


async def close_due_auctions(session_factory: async_sessionmaker[AsyncSession], now: datetime | None = None) -> list[str]:
    """Returns the ids of RFQs closed by this run (callers publish events for them after commit)."""
    at = now or datetime.now(timezone.utc)
    closed: list[str] = []
    async with session_factory() as s, s.begin():
        due = (
            await s.scalars(
                select(Rfq)
                .where(Rfq.closed_status.is_(None), Rfq.current_close_time <= at)
                .order_by(Rfq.current_close_time)
                .limit(500)
                .with_for_update(skip_locked=True)
            )
        ).all()
        for r in due:
            status = get_status(r.bid_start_time, r.current_close_time, r.forced_close_time, at)
            if status not in ("CLOSED", "FORCE_CLOSED"):
                continue
            r.closed_status = status
            r.closed_at = at
            forced = status == "FORCE_CLOSED"
            s.add(
                ActivityLog(
                    rfq_id=r.id,
                    type="AUCTION_FORCE_CLOSED" if forced else "AUCTION_CLOSED",
                    message=(
                        f"Auction force closed at forced close time {_fmt(r.forced_close_time)}"
                        if forced
                        else f"Auction closed at {_fmt(r.current_close_time)}"
                        + (f" after {r.extension_count} extension(s)" if r.extension_count else "")
                    ),
                    metadata_=json.dumps({"status": status, "closeTime": iso(r.current_close_time), "extensionCount": r.extension_count}),
                    created_at=r.current_close_time,
                )
            )
            closed.append(r.id)
    return closed
