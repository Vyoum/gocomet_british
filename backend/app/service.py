import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Callable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .auction import ExtensionInput, SimpleBid, evaluate_extension, get_status, rank_bids, ranking_order, validate_rfq_times
from .errors import HttpError
from .events import bus
from .models import ActivityLog, Bid, Rfq, Supplier
from .money import fmt_money, from_minor
from .schemas import BidIn, RfqIn
from .serialize import activity_out, bid_out, iso, rfq_out, supplier_out


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _status(r: Rfq, now: datetime) -> str:
    return get_status(r.bid_start_time, r.current_close_time, r.forced_close_time, now)


def _fmt(d: datetime) -> str:
    return iso(d).replace("T", " ")[:19] + "Z"


def _mins(m: float) -> str:
    return str(int(m)) if float(m).is_integer() else f"{m:.2f}".rstrip("0")


async def list_suppliers(s: AsyncSession) -> list[dict]:
    rows = (await s.scalars(select(Supplier).order_by(Supplier.name))).all()
    return [supplier_out(x) for x in rows]


async def create_rfq(s: AsyncSession, data: RfqIn) -> dict:
    errors = validate_rfq_times(
        data.bidStartTime, data.bidCloseTime, data.forcedCloseTime, data.triggerWindowMinutes, data.extensionMinutes
    )
    if errors:
        raise HttpError(400, "; ".join(errors), errors)
    async with s.begin():
        if await s.scalar(select(Rfq.id).where(Rfq.reference_id == data.referenceId)):
            raise HttpError(409, f"Reference ID {data.referenceId} already exists")
        rfq = Rfq(
            reference_id=data.referenceId,
            name=data.name,
            bid_start_time=data.bidStartTime,
            bid_close_time=data.bidCloseTime,
            current_close_time=data.bidCloseTime,
            forced_close_time=data.forcedCloseTime,
            pickup_date=data.pickupDate,
            trigger_window_minutes=data.triggerWindowMinutes,
            extension_minutes=data.extensionMinutes,
            trigger_type=data.triggerType,
        )
        s.add(rfq)
        await s.flush()
        s.add(
            ActivityLog(
                rfq_id=rfq.id,
                type="RFQ_CREATED",
                message=f"RFQ created. Trigger: {data.triggerType}, X={data.triggerWindowMinutes} min, Y={data.extensionMinutes} min",
            )
        )
    await s.refresh(rfq)
    bus.publish(rfq.id)
    return rfq_out(rfq)


MAX_IDEMPOTENCY_KEY_LEN = 255


class BidResult(dict):
    """The bid response body; `replayed` is True when it was served from an earlier Idempotency-Key."""

    def __init__(self, body: dict, replayed: bool = False):
        super().__init__(body)
        self.replayed = replayed


def bid_fingerprint(data: BidIn) -> str:
    """Stable hash of the (normalized) bid payload, used to detect Idempotency-Key reuse with a different body."""
    payload = json.dumps(data.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def validate_idempotency_key(key: str | None) -> str | None:
    if key is None:
        return None
    key = key.strip()
    if not key or len(key) > MAX_IDEMPOTENCY_KEY_LEN or not key.isprintable():
        raise HttpError(400, f"Idempotency-Key must be 1-{MAX_IDEMPOTENCY_KEY_LEN} printable characters")
    return key


async def place_bid(
    s: AsyncSession, rfq_id: str, data: BidIn, now: Callable[[], datetime] = utcnow, idempotency_key: str | None = None
) -> dict:
    """
    Race safety: the whole read-rank-extend-write sequence runs in ONE transaction that first takes a
    row lock on the RFQ (SELECT ... FOR UPDATE). Concurrent bids on the same RFQ queue on that lock, so
    each one sees the previous bid and the already-extended close time. `now` is read after the lock.

    Idempotency: with an Idempotency-Key, the lookup of an earlier bid with that key happens AFTER the RFQ
    lock, so concurrent duplicates queue and the later one sees the committed original and replays its stored
    response (no new bid, extension, log entry or SSE event). The (rfqId, idempotencyKey) unique constraint
    is a backstop. A replay is returned even if the auction has since closed.
    """
    key = validate_idempotency_key(idempotency_key)
    fingerprint = bid_fingerprint(data) if key else None
    async with s.begin():
        rfq = await s.scalar(select(Rfq).where(Rfq.id == rfq_id).with_for_update())
        if rfq is None:
            raise HttpError(404, "RFQ not found")
        if key:
            prior = await s.scalar(select(Bid).where(Bid.rfq_id == rfq_id, Bid.idempotency_key == key))
            if prior is not None:
                if prior.idempotency_hash != fingerprint:
                    raise HttpError(422, "Idempotency-Key was already used for a different bid payload on this RFQ")
                return BidResult(json.loads(prior.idempotency_response), replayed=True)
        supplier = await s.get(Supplier, data.supplierId)
        if supplier is None:
            raise HttpError(400, "Unknown supplier")

        at = now()
        status = _status(rfq, at)
        if status != "ACTIVE":
            raise HttpError(409, f"Bidding not open (status: {status})")

        total = data.freightCharges + data.originCharges + data.destinationCharges
        if total <= 0:
            raise HttpError(400, "Total price must be > 0")
        if data.quoteValidUntil <= at:
            raise HttpError(400, "Quote validity must be in the future")

        rows = (await s.execute(select(Bid.supplier_id, Bid.total_price, Bid.created_at).where(Bid.rfq_id == rfq_id))).all()
        existing = [SimpleBid(r[0], r[1], r[2]) for r in rows]
        prev_own = next((b for _, b in rank_bids(existing) if b.supplier_id == supplier.id), None)
        if prev_own and total >= prev_own.total_price:
            raise HttpError(400, f"Re-bid must be lower than your previous bid of {fmt_money(prev_own.total_price)}")

        before = ranking_order(existing)
        bid = Bid(
            rfq_id=rfq_id,
            supplier_id=supplier.id,
            freight_charges=data.freightCharges,
            origin_charges=data.originCharges,
            destination_charges=data.destinationCharges,
            total_price=total,
            transit_time_days=data.transitTimeDays,
            quote_valid_until=data.quoteValidUntil,
            created_at=at,
            idempotency_key=key,
            idempotency_hash=fingerprint,
        )
        s.add(bid)
        await s.flush()
        after = ranking_order([*existing, SimpleBid(supplier.id, total, at)])
        rank = after.index(supplier.id) + 1

        s.add(
            ActivityLog(
                rfq_id=rfq_id,
                type="BID_PLACED",
                message=f"{supplier.name} {'re-bid' if prev_own else 'bid'} {fmt_money(total)} (now L{rank})",
                metadata_=json.dumps({"bidId": bid.id, "totalPrice": from_minor(total), "rank": rank}),
                created_at=at,
            )
        )

        old_close = rfq.current_close_time
        d = evaluate_extension(
            ExtensionInput(
                trigger_type=rfq.trigger_type,
                trigger_window_minutes=rfq.trigger_window_minutes,
                extension_minutes=rfq.extension_minutes,
                current_close_time=old_close,
                forced_close_time=rfq.forced_close_time,
                bid_time=at,
                ranking_before=before,
                ranking_after=after,
                supplier_name=supplier.name,
            )
        )
        if d.extend:
            rfq.current_close_time = d.new_close_time
            rfq.extension_count = rfq.extension_count + 1
            s.add(
                ActivityLog(
                    rfq_id=rfq_id,
                    type="EXTENDED",
                    message=f"Close time extended {_fmt(old_close)} → {_fmt(d.new_close_time)}. Reason: {d.reason}",
                    metadata_=json.dumps({"from": iso(old_close), "to": iso(d.new_close_time), "capped": d.capped_at_forced_close}),
                    created_at=at + timedelta(milliseconds=1),
                )
            )
        if d.triggered and d.granted_minutes < rfq.extension_minutes:
            full = not d.extend
            s.add(
                ActivityLog(
                    rfq_id=rfq_id,
                    type="EXTENSION_CAPPED",
                    message=(
                        f"Extension {'blocked' if full else 'capped'} by forced close time {_fmt(rfq.forced_close_time)}: "
                        f"requested +{rfq.extension_minutes} min, granted +{_mins(d.granted_minutes)} min. "
                        f"Trigger: {d.reason.split(';')[0]}"
                    ),
                    metadata_=json.dumps(
                        {
                            "requestedMinutes": rfq.extension_minutes,
                            "grantedMinutes": d.granted_minutes,
                            "fullyCapped": full,
                            "from": iso(old_close),
                            "to": iso(d.new_close_time),
                            "forcedCloseTime": iso(rfq.forced_close_time),
                        }
                    ),
                    created_at=at + timedelta(milliseconds=2),
                )
            )
        result = {
            "bid": bid_out(bid),
            "rank": rank,
            "extension": {
                "extend": d.extend,
                "newCloseTime": iso(d.new_close_time),
                "cappedAtForcedClose": d.capped_at_forced_close,
                "reason": d.reason,
            },
        }
        if key:
            bid.idempotency_response = json.dumps(result)
    bus.publish(rfq_id)
    return BidResult(result)


async def list_rfqs(s: AsyncSession, now: datetime | None = None) -> dict:
    now = now or utcnow()
    rfqs = (await s.scalars(select(Rfq).options(selectinload(Rfq.bids)).order_by(Rfq.bid_start_time.desc()))).all()
    items = []
    for r in rfqs:
        ranked = rank_bids(r.bids)
        items.append(
            {
                **rfq_out(r),
                "status": _status(r, now),
                "lowestBid": from_minor(ranked[0][1].total_price) if ranked else None,
                "bidCount": len(r.bids),
                "supplierCount": len(ranked),
            }
        )
    return {"serverTime": iso(now), "rfqs": items}


async def get_rfq_details(s: AsyncSession, rfq_id: str, now: datetime | None = None) -> dict:
    now = now or utcnow()
    rfq = await s.scalar(
        select(Rfq).where(Rfq.id == rfq_id).options(selectinload(Rfq.bids).selectinload(Bid.supplier), selectinload(Rfq.activity))
    )
    if rfq is None:
        raise HttpError(404, "RFQ not found")

    def full(b: Bid) -> dict:
        return {**bid_out(b), "supplier": supplier_out(b.supplier), "supplierName": b.supplier.name}

    ranked = [{**full(b), "rank": rank, "label": f"L{rank}"} for rank, b in rank_bids(rfq.bids)]
    all_bids = [full(b) for b in sorted(rfq.bids, key=lambda b: b.created_at, reverse=True)]
    activity = [activity_out(a) for a in sorted(rfq.activity, key=lambda a: a.created_at, reverse=True)]
    return {
        **rfq_out(rfq),
        "status": _status(rfq, now),
        "serverTime": iso(now),
        "rankedBids": ranked,
        "allBids": all_bids,
        "activity": activity,
    }


async def supplier_count(s: AsyncSession) -> int:
    return await s.scalar(select(func.count()).select_from(Supplier)) or 0
