"""Pure British Auction logic (no DB). Unit tested in tests/test_auction.py."""
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Literal, Protocol, Sequence, TypeVar

TRIGGER_TYPES = ("BID_RECEIVED", "ANY_RANK_CHANGE", "L1_CHANGE")
TriggerType = Literal["BID_RECEIVED", "ANY_RANK_CHANGE", "L1_CHANGE"]
Status = Literal["UPCOMING", "ACTIVE", "CLOSED", "FORCE_CLOSED"]


class BidLike(Protocol):
    supplier_id: str
    total_price: int
    created_at: datetime


@dataclass(frozen=True)
class SimpleBid:
    supplier_id: str
    total_price: int
    created_at: datetime


B = TypeVar("B", bound=BidLike)


def rank_bids(bids: Sequence[B]) -> list[tuple[int, B]]:
    """Only each supplier's latest bid counts. Rank by total asc; ties -> earlier bid wins. Returns (rank, bid)."""
    latest: dict[str, B] = {}
    for b in bids:
        cur = latest.get(b.supplier_id)
        if cur is None or b.created_at >= cur.created_at:
            latest[b.supplier_id] = b
    ordered = sorted(latest.values(), key=lambda b: (b.total_price, b.created_at))
    return [(i + 1, b) for i, b in enumerate(ordered)]


def ranking_order(bids: Sequence[BidLike]) -> list[str]:
    return [b.supplier_id for _, b in rank_bids(bids)]


def get_status(bid_start: datetime, current_close: datetime, forced_close: datetime, now: datetime) -> Status:
    if now < bid_start:
        return "UPCOMING"
    if now < current_close:
        return "ACTIVE"
    return "FORCE_CLOSED" if current_close >= forced_close else "CLOSED"


def is_in_trigger_window(current_close: datetime, window_minutes: int, at: datetime) -> bool:
    return current_close - timedelta(minutes=window_minutes) <= at < current_close


@dataclass
class ExtensionInput:
    trigger_type: str
    trigger_window_minutes: int
    extension_minutes: int
    current_close_time: datetime
    forced_close_time: datetime
    bid_time: datetime
    ranking_before: list[str]
    ranking_after: list[str]
    supplier_name: str | None = None


@dataclass
class ExtensionDecision:
    extend: bool
    new_close_time: datetime
    capped_at_forced_close: bool
    reason: str = field(default="")
    # True when the configured trigger condition was met (whether or not time could actually be added)
    triggered: bool = False
    # Minutes actually added (may be < extension_minutes when capped, 0 when already at forced close)
    granted_minutes: float = 0.0


def evaluate_extension(i: ExtensionInput) -> ExtensionDecision:
    """Decide whether a newly accepted bid extends the auction, measured against the CURRENT (possibly extended) close."""

    def no(reason: str) -> ExtensionDecision:
        return ExtensionDecision(False, i.current_close_time, False, reason)

    if not is_in_trigger_window(i.current_close_time, i.trigger_window_minutes, i.bid_time):
        return no("Bid outside trigger window")
    who = i.supplier_name or "a supplier"
    x = i.trigger_window_minutes
    why: str | None = None
    if i.trigger_type == "BID_RECEIVED":
        why = f"Bid received from {who} within last {x} min"
    elif i.trigger_type == "ANY_RANK_CHANGE":
        if i.ranking_before != i.ranking_after:
            why = f"Supplier ranking changed (bid by {who}) within last {x} min"
    elif i.trigger_type == "L1_CHANGE":
        first_before = i.ranking_before[0] if i.ranking_before else None
        first_after = i.ranking_after[0] if i.ranking_after else None
        if first_after != first_before:
            why = f"New L1 (lowest bidder): {who} within last {x} min"
    if not why:
        return no(f"Trigger {i.trigger_type} not met")
    if i.current_close_time >= i.forced_close_time:
        # Trigger fired but there is no room left: fully capped (no extension).
        return ExtensionDecision(False, i.current_close_time, True, f"{why}; not extended: already at forced close time", True, 0.0)

    proposed = i.current_close_time + timedelta(minutes=i.extension_minutes)
    capped = proposed >= i.forced_close_time
    new_close = min(proposed, i.forced_close_time)
    suffix = " (capped at forced close time)" if capped else ""
    granted = (new_close - i.current_close_time).total_seconds() / 60
    return ExtensionDecision(True, new_close, capped, f"{why}; extended by {i.extension_minutes} min{suffix}", True, granted)


def validate_rfq_times(bid_start: datetime, bid_close: datetime, forced_close: datetime, x: int, y: int) -> list[str]:
    e: list[str] = []
    if not bid_close > bid_start:
        e.append("Bid close time must be after bid start time")
    if not forced_close > bid_close:
        e.append("Forced close time must be after bid close time")
    if not x > 0:
        e.append("Trigger window X must be > 0")
    if not y > 0:
        e.append("Extension duration Y must be > 0")
    return e
