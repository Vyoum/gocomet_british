"""ORM rows -> API dicts with the same camelCase shape the Express/Prisma API returned."""
from datetime import datetime, timezone

from .models import ActivityLog, Bid, Rfq, Supplier
from .money import from_minor


def iso(d: datetime) -> str:
    """ISO 8601 UTC with milliseconds and Z, like JS Date#toJSON."""
    return d.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def supplier_out(s: Supplier) -> dict:
    return {"id": s.id, "name": s.name, "createdAt": iso(s.created_at)}


def rfq_out(r: Rfq) -> dict:
    return {
        "id": r.id,
        "referenceId": r.reference_id,
        "name": r.name,
        "bidStartTime": iso(r.bid_start_time),
        "bidCloseTime": iso(r.bid_close_time),
        "currentCloseTime": iso(r.current_close_time),
        "forcedCloseTime": iso(r.forced_close_time),
        "pickupDate": iso(r.pickup_date),
        "triggerWindowMinutes": r.trigger_window_minutes,
        "extensionMinutes": r.extension_minutes,
        "triggerType": r.trigger_type,
        "extensionCount": r.extension_count,
        "createdAt": iso(r.created_at),
    }


def bid_out(b: Bid) -> dict:
    return {
        "id": b.id,
        "rfqId": b.rfq_id,
        "supplierId": b.supplier_id,
        "freightCharges": from_minor(b.freight_charges),
        "originCharges": from_minor(b.origin_charges),
        "destinationCharges": from_minor(b.destination_charges),
        "totalPrice": from_minor(b.total_price),
        "transitTimeDays": b.transit_time_days,
        "quoteValidUntil": iso(b.quote_valid_until),
        "createdAt": iso(b.created_at),
    }


def activity_out(a: ActivityLog) -> dict:
    return {
        "id": a.id,
        "rfqId": a.rfq_id,
        "type": a.type,
        "message": a.message,
        "metadata": a.metadata_,
        "createdAt": iso(a.created_at),
    }
