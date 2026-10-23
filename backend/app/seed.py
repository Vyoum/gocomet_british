"""
python -m app.seed         -> wipe and load short-window demo data (local dev; same as the old prisma/seed.ts)
python -m app.seed --demo  -> deployment demo: long 1-2 week windows, ONLY when the DB is empty (never wipes)
"""
import asyncio
import sys
from datetime import datetime, timedelta

from sqlalchemy import delete

from .db import SessionLocal, engine
from .models import ActivityLog, Bid, Rfq, Supplier
from .service import supplier_count, utcnow

NAMES = ["BlueDart Logistics", "Maersk Line", "DHL Global Forwarding", "Gati Cargo", "Safexpress"]

# (ref, name, start, close, forced, trigger, X, Y) offsets in minutes from now
DEV_RFQS = [
    ("RFQ-1001", "Mumbai → Rotterdam 2x40HC", -30, 8, 30, "BID_RECEIVED", 10, 5),
    ("RFQ-1002", "Delhi → Chennai FTL 20T", -10, 45, 90, "L1_CHANGE", 10, 5),
    ("RFQ-1003", "Chennai → Singapore LCL", -5, 3, 15, "ANY_RANK_CHANGE", 5, 3),
    ("RFQ-1004", "Kolkata → Dhaka Air", 60, 180, 240, "BID_RECEIVED", 15, 10),
    ("RFQ-0999", "Pune → Bengaluru PTL", -300, -120, -60, "L1_CHANGE", 10, 5),
]
DEMO_RFQS = [
    ("RFQ-1001", "Mumbai → Rotterdam 2x40HC", -30, 10080, 11520, "BID_RECEIVED", 10, 5),
    ("RFQ-1002", "Delhi → Chennai FTL 20T", -10, 14400, 15840, "L1_CHANGE", 10, 5),
    ("RFQ-1003", "Chennai → Singapore LCL", -5, 20160, 21600, "ANY_RANK_CHANGE", 5, 3),
    ("RFQ-1004", "Kolkata → Dhaka Air", 2880, 28800, 30240, "BID_RECEIVED", 15, 10),
    ("RFQ-0999", "Pune → Bengaluru PTL", -300, -120, -60, "L1_CHANGE", 10, 5),
]
# (rfq ref, supplier idx, freight, origin, destination, minutes) in major units
BIDS = [
    ("RFQ-1001", 0, 2000, 150, 200, -25),
    ("RFQ-1001", 1, 1900, 120, 180, -20),
    ("RFQ-1001", 2, 2100, 100, 150, -15),
    ("RFQ-0999", 3, 900, 50, 50, -200),
    ("RFQ-0999", 4, 850, 60, 40, -150),
]
MESSAGES = [
    ("RFQ-1001", "BlueDart Logistics bid $2,350.00 (now L1)", -25),
    ("RFQ-1001", "Maersk Line bid $2,200.00 (now L1)", -20),
    ("RFQ-1001", "DHL Global Forwarding bid $2,350.00 (now L3)", -15),
    ("RFQ-0999", "Gati Cargo bid 1000.00 (now L1)", -200),
    ("RFQ-0999", "Safexpress bid 950.00 (now L1)", -150),
]


async def seed(demo: bool = False) -> bool:
    now = utcnow()

    def at(m: float) -> datetime:
        return now + timedelta(minutes=m)

    async with SessionLocal() as s, s.begin():
        if demo and await supplier_count(s) > 0:
            print("Demo seed skipped: data exists")
            return False
        for model in (ActivityLog, Bid, Rfq, Supplier):
            await s.execute(delete(model))
        suppliers = [Supplier(name=n) for n in NAMES]
        s.add_all(suppliers)
        rfqs: dict[str, Rfq] = {}
        for ref, name, start, close, forced, trig, x, y in DEMO_RFQS if demo else DEV_RFQS:
            r = Rfq(
                reference_id=ref, name=name, trigger_type=trig, trigger_window_minutes=x, extension_minutes=y,
                bid_start_time=at(start), bid_close_time=at(close), current_close_time=at(close), forced_close_time=at(forced),
                pickup_date=at(60 * 24 * (25 if demo else 7)),
            )
            rfqs[ref] = r
            s.add(r)
        await s.flush()
        for ref, r in rfqs.items():
            s.add(ActivityLog(rfq_id=r.id, type="RFQ_CREATED", created_at=r.bid_start_time,
                              message=f"RFQ created. Trigger: {r.trigger_type}, X={r.trigger_window_minutes} min, Y={r.extension_minutes} min"))
        validity = at(60 * 24 * (40 if demo else 30))
        for ref, si, f, o, d, m in BIDS:
            s.add(Bid(rfq_id=rfqs[ref].id, supplier_id=suppliers[si].id, freight_charges=f * 100, origin_charges=o * 100,
                      destination_charges=d * 100, total_price=(f + o + d) * 100, transit_time_days=21,
                      quote_valid_until=validity, created_at=at(m)))
        for ref, msg, m in MESSAGES:
            s.add(ActivityLog(rfq_id=rfqs[ref].id, type="BID_PLACED", message=msg, created_at=at(m)))
    print(f"Seeded {len(NAMES)} suppliers and {len(rfqs)} RFQs")
    return True


async def _main() -> None:
    try:
        await seed(demo="--demo" in sys.argv)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(_main())
