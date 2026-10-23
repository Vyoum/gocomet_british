import asyncio
import json
from datetime import datetime, timedelta, timezone

from app.events import bus
from app.seed import seed


def iso(d: datetime) -> str:
    return d.isoformat().replace("+00:00", "Z")


def now() -> datetime:
    return datetime.now(timezone.utc)


async def make_rfq(client, ref="T-1", start=-5, close=60, forced=120, trigger="BID_RECEIVED", x=10, y=5):
    n = now()
    r = await client.post("/api/rfqs", json={
        "referenceId": ref, "name": "Test lane", "bidStartTime": iso(n + timedelta(minutes=start)),
        "bidCloseTime": iso(n + timedelta(minutes=close)), "forcedCloseTime": iso(n + timedelta(minutes=forced)),
        "pickupDate": iso(n + timedelta(days=7)), "triggerWindowMinutes": x, "extensionMinutes": y, "triggerType": trigger,
    })
    assert r.status_code == 201, r.text
    return r.json()


async def suppliers(client):
    await seed()  # dev seed gives 5 suppliers + 5 RFQs
    return (await client.get("/api/suppliers")).json()


def bid_body(sid, f=1000, o=100, d=50):
    return {"supplierId": sid, "freightCharges": f, "originCharges": o, "destinationCharges": d,
            "transitTimeDays": 10, "quoteValidUntil": iso(now() + timedelta(days=30))}


async def test_health(client):
    r = await client.get("/api/health")
    assert r.status_code == 200 and r.json()["ok"] is True


async def test_seed_and_list_shape(client):
    sup = await suppliers(client)
    assert [s["name"] for s in sup] == sorted(s["name"] for s in sup) and set(sup[0]) == {"id", "name", "createdAt"}
    body = (await client.get("/api/rfqs")).json()
    assert set(body) == {"serverTime", "rfqs"} and body["serverTime"].endswith("Z")
    by_ref = {r["referenceId"]: r for r in body["rfqs"]}
    r = by_ref["RFQ-1001"]
    assert r["status"] == "ACTIVE" and r["lowestBid"] == 2200 and r["bidCount"] == 3 and r["supplierCount"] == 3
    assert by_ref["RFQ-0999"]["status"] == "CLOSED" and by_ref["RFQ-1004"]["status"] == "UPCOMING"
    assert by_ref["RFQ-1002"]["lowestBid"] is None
    expected = {"id", "referenceId", "name", "bidStartTime", "bidCloseTime", "currentCloseTime", "forcedCloseTime",
                "pickupDate", "triggerWindowMinutes", "extensionMinutes", "triggerType", "extensionCount", "createdAt",
                "status", "lowestBid", "bidCount", "supplierCount", "topRanks"}
    assert set(r) == expected
    starts = [x["bidStartTime"] for x in body["rfqs"]]
    assert starts == sorted(starts, reverse=True)


async def test_details_shape(client):
    await suppliers(client)
    rfq = next(r for r in (await client.get("/api/rfqs")).json()["rfqs"] if r["referenceId"] == "RFQ-1001")
    d = (await client.get(f"/api/rfqs/{rfq['id']}")).json()
    assert [b["label"] for b in d["rankedBids"]] == ["L1", "L2", "L3"]
    assert d["rankedBids"][0]["supplierName"] == "Maersk Line" and d["rankedBids"][0]["totalPrice"] == 2200
    assert d["rankedBids"][0]["supplier"]["name"] == "Maersk Line"
    assert d["allBids"][0]["supplierName"] == "DHL Global Forwarding"  # newest first
    assert d["activity"][0]["type"] == "BID_PLACED" and "serverTime" in d
    assert (await client.get("/api/rfqs/nope")).json() == {"error": "RFQ not found"}


async def test_create_rfq_errors(client):
    rfq = await make_rfq(client)
    assert rfq["currentCloseTime"] == rfq["bidCloseTime"] and rfq["extensionCount"] == 0
    r = await client.post("/api/rfqs", json={k: v for k, v in rfq.items()} | {"referenceId": "T-1"})
    assert r.status_code == 409 and r.json()["error"] == "Reference ID T-1 already exists"
    r = await client.post("/api/rfqs", json=rfq | {"referenceId": "T-2", "forcedCloseTime": rfq["bidCloseTime"]})
    assert r.status_code == 400 and r.json() == {"error": "Forced close time must be after bid close time",
                                                 "details": ["Forced close time must be after bid close time"]}
    r = await client.post("/api/rfqs", json=rfq | {"triggerType": "NOPE", "triggerWindowMinutes": ""})
    j = r.json()
    assert r.status_code == 400 and j["error"] == "Validation failed"
    assert {tuple(d["path"]) for d in j["details"]} == {("triggerType",), ("triggerWindowMinutes",)}
    r = await client.post("/api/rfqs", content=b"{bad", headers={"content-type": "application/json"})
    assert r.status_code == 400 and r.json() == {"error": "Malformed JSON body"}


async def test_bid_flow_and_rules(client):
    sup = await suppliers(client)
    rfq = await make_rfq(client, close=5, forced=12, x=10, y=5)  # in window; 5->10, then capped at 12
    url = f"/api/rfqs/{rfq['id']}/bids"
    r = await client.post(url, json=bid_body(sup[0]["id"], f="1000.50"))
    j = r.json()
    assert r.status_code == 201 and j["rank"] == 1 and j["bid"]["totalPrice"] == 1150.5
    assert j["extension"]["extend"] and j["extension"]["cappedAtForcedClose"] is False
    r = await client.post(url, json=bid_body(sup[0]["id"], f=1000.5))
    assert r.status_code == 400 and r.json()["error"] == "Re-bid must be lower than your previous bid of $1,150.50"
    r = await client.post(url, json=bid_body(sup[1]["id"], f=2000))  # higher than L1 is fine (own first bid)
    assert r.status_code == 201 and r.json()["rank"] == 2
    assert r.json()["extension"]["cappedAtForcedClose"] is True  # 10+5 > 12 -> capped
    r = await client.post(url, json=bid_body("ghost"))
    assert r.status_code == 400 and r.json()["error"] == "Unknown supplier"
    r = await client.post(url, json=bid_body(sup[2]["id"], f=0, o=0, d=0))
    assert r.status_code == 400 and r.json()["details"][0]["path"] == ["freightCharges"]
    r = await client.post(url, json=bid_body(sup[2]["id"]) | {"quoteValidUntil": iso(now() - timedelta(days=1))})
    assert r.status_code == 400 and r.json()["error"] == "Quote validity must be in the future"
    d = (await client.get(f"/api/rfqs/{rfq['id']}")).json()
    assert d["extensionCount"] == 2 and d["currentCloseTime"] == d["forcedCloseTime"]
    ext = [a for a in d["activity"] if a["type"] == "EXTENDED"]
    assert len(ext) == 2 and "Reason: Bid received from" in ext[0]["message"]
    assert json.loads(ext[0]["metadata"])["capped"] is True
    assert (await client.post("/api/rfqs/nope/bids", json=bid_body(sup[0]["id"]))).status_code == 404


async def test_bidding_not_open(client):
    sup = await suppliers(client)
    rfq = await make_rfq(client, start=30, close=60, forced=90)
    r = await client.post(f"/api/rfqs/{rfq['id']}/bids", json=bid_body(sup[0]["id"]))
    assert r.status_code == 409 and r.json()["error"] == "Bidding not open (status: UPCOMING)"


async def test_l1_change_trigger_end_to_end(client):
    sup = await suppliers(client)
    rfq = await make_rfq(client, close=5, forced=60, trigger="L1_CHANGE")
    url = f"/api/rfqs/{rfq['id']}/bids"
    assert (await client.post(url, json=bid_body(sup[0]["id"], f=1000))).json()["extension"]["extend"]  # first bid
    assert not (await client.post(url, json=bid_body(sup[1]["id"], f=2000))).json()["extension"]["extend"]  # L2
    assert not (await client.post(url, json=bid_body(sup[0]["id"], f=900))).json()["extension"]["extend"]  # L1 lowers own
    assert (await client.post(url, json=bid_body(sup[1]["id"], f=500))).json()["extension"]["extend"]  # new L1


async def test_concurrent_bids_are_serialized(client):
    """5 simultaneous in-window bids: the row lock makes each one see the previous extension (5 x 1 min)."""
    sup = await suppliers(client)
    rfq = await make_rfq(client, close=5, forced=600, x=10, y=1)
    url = f"/api/rfqs/{rfq['id']}/bids"
    rs = await asyncio.gather(*(client.post(url, json=bid_body(s["id"], f=5000 - i * 10)) for i, s in enumerate(sup)))
    assert all(r.status_code == 201 for r in rs), [r.text for r in rs]
    d = (await client.get(f"/api/rfqs/{rfq['id']}")).json()
    assert d["extensionCount"] == 5
    assert datetime.fromisoformat(d["currentCloseTime"]) == datetime.fromisoformat(rfq["bidCloseTime"]) + timedelta(minutes=5)
    assert sorted(b["rank"] for b in d["rankedBids"]) == [1, 2, 3, 4, 5]


async def test_events_bus_publishes_on_bid(client):
    sup = await suppliers(client)
    rfq = await make_rfq(client)
    q = bus.subscribe()
    try:
        await client.post(f"/api/rfqs/{rfq['id']}/bids", json=bid_body(sup[0]["id"]))
        assert await asyncio.wait_for(q.get(), 1) == rfq["id"]
    finally:
        bus.unsubscribe(q)


async def test_demo_seed_only_when_empty(client):
    from app.seed import seed as run
    assert await run(demo=True) is True
    assert await run(demo=True) is False
    rfqs = (await client.get("/api/rfqs")).json()["rfqs"]
    r = next(x for x in rfqs if x["referenceId"] == "RFQ-1001")
    assert datetime.fromisoformat(r["bidCloseTime"]) - now() > timedelta(days=6)


async def _ranks(client, ref):
    rfq = next(r for r in (await client.get("/api/rfqs")).json()["rfqs"] if r["referenceId"] == ref)
    return rfq["topRanks"]


async def test_top_ranks_empty_and_order(client):
    sup = await suppliers(client)
    rfq = await make_rfq(client, ref="TR-1")
    assert await _ranks(client, "TR-1") == []
    assert (await _ranks(client, "RFQ-1002")) == []
    seeded = await _ranks(client, "RFQ-1001")
    assert seeded[0]["rank"] == 1 and seeded[0]["total"] == 2200
    for s_, f in zip(sup[:4], [3000, 1000, 2000, 4000]):
        assert (await client.post(f"/api/rfqs/{rfq['id']}/bids", json=bid_body(s_["id"], f=f))).status_code == 201
    tr = await _ranks(client, "TR-1")
    assert [t["rank"] for t in tr] == [1, 2, 3]
    assert [t["carrierName"] for t in tr] == [sup[1]["name"], sup[2]["name"], sup[0]["name"]]
    assert [t["total"] for t in tr] == [1150, 2150, 3150]
    assert set(tr[0]) == {"rank", "carrierName", "total"}


async def test_top_ranks_tie_and_latest_bid(client):
    sup = await suppliers(client)
    rfq = await make_rfq(client, ref="TR-2")
    url = f"/api/rfqs/{rfq['id']}/bids"
    assert (await client.post(url, json=bid_body(sup[0]["id"], f=2000))).status_code == 201
    assert (await client.post(url, json=bid_body(sup[1]["id"], f=2000))).status_code == 201  # tie -> earlier wins
    tr = await _ranks(client, "TR-2")
    assert [t["carrierName"] for t in tr] == [sup[0]["name"], sup[1]["name"]]
    assert (await client.post(url, json=bid_body(sup[1]["id"], f=1500))).status_code == 201  # latest bid counts
    tr = await _ranks(client, "TR-2")
    assert [(t["carrierName"], t["total"]) for t in tr] == [(sup[1]["name"], 1650), (sup[0]["name"], 2150)]
    details = (await client.get(f"/api/rfqs/{rfq['id']}")).json()["rankedBids"]
    assert [b["supplierName"] for b in details][:3] == [t["carrierName"] for t in tr]
