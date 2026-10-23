"""Idempotency-Key on bids, EXTENSION_CAPPED activity, and the Celery auto-close task."""
import asyncio
import json
from datetime import timedelta

import psycopg

from app import worker
from app.events import bus

from .test_api import bid_body, make_rfq, now, suppliers


def acts(d, t):
    return [a for a in d["activity"] if a["type"] == t]


async def details(client, rfq_id):
    return (await client.get(f"/api/rfqs/{rfq_id}")).json()


async def test_idempotent_repeat_returns_original(client):
    sup = await suppliers(client)
    rfq = await make_rfq(client, close=5, forced=60)  # in window -> first bid extends
    url, body, h = f"/api/rfqs/{rfq['id']}/bids", bid_body(sup[0]["id"]), {"Idempotency-Key": "k-1"}
    q = bus.subscribe()
    try:
        r1 = await client.post(url, json=body, headers=h)
        assert r1.status_code == 201 and r1.headers["Idempotent-Replayed"] == "false"
        assert r1.json()["extension"]["extend"] is True
        assert q.qsize() == 1
        before = await details(client, rfq["id"])
        r2 = await client.post(url, json=body, headers=h)
        assert r2.status_code == 201 and r2.json() == r1.json() and r2.headers["Idempotent-Replayed"] == "true"
        assert q.qsize() == 1  # no duplicate SSE event
    finally:
        bus.unsubscribe(q)
    after = await details(client, rfq["id"])
    assert len(after["allBids"]) == 1 and after["activity"] == before["activity"]
    assert after["currentCloseTime"] == before["currentCloseTime"] and after["extensionCount"] == 1
    # Same key is scoped per RFQ; no key keeps old behaviour (header absent)
    other = await make_rfq(client, ref="T-2")
    r3 = await client.post(f"/api/rfqs/{other['id']}/bids", json=body, headers=h)
    assert r3.status_code == 201 and r3.json()["bid"]["id"] != r1.json()["bid"]["id"]
    r4 = await client.post(url, json=bid_body(sup[1]["id"]))
    assert r4.status_code == 201 and "Idempotent-Replayed" not in r4.headers


async def test_idempotent_mismatch_and_bad_key(client):
    sup = await suppliers(client)
    rfq = await make_rfq(client)
    url = f"/api/rfqs/{rfq['id']}/bids"
    assert (await client.post(url, json=bid_body(sup[0]["id"]), headers={"Idempotency-Key": "k"})).status_code == 201
    r = await client.post(url, json=bid_body(sup[0]["id"], f=900), headers={"Idempotency-Key": "k"})
    assert r.status_code == 422 and "different bid payload" in r.json()["error"]
    r = await client.post(url, json=bid_body(sup[1]["id"]), headers={"Idempotency-Key": "x" * 256})
    assert r.status_code == 400 and "Idempotency-Key" in r.json()["error"]
    assert len((await details(client, rfq["id"]))["allBids"]) == 1


async def test_idempotent_concurrent_duplicates(client):
    sup = await suppliers(client)
    rfq = await make_rfq(client, close=5, forced=60)
    url, body = f"/api/rfqs/{rfq['id']}/bids", bid_body(sup[0]["id"])
    rs = await asyncio.gather(*[client.post(url, json=body, headers={"Idempotency-Key": "same"}) for _ in range(8)])
    assert all(r.status_code == 201 for r in rs), [r.text for r in rs]
    assert len({r.json()["bid"]["id"] for r in rs}) == 1
    assert sorted(r.headers["Idempotent-Replayed"] for r in rs) == ["false"] + ["true"] * 7
    d = await details(client, rfq["id"])
    assert len(d["allBids"]) == 1 and len(acts(d, "BID_PLACED")) == 1 and len(acts(d, "EXTENDED")) == 1
    assert d["extensionCount"] == 1


async def test_extension_capped_log(client):
    sup = await suppliers(client)
    rfq = await make_rfq(client, close=5, forced=12, x=15, y=5)  # window covers until forced close
    url = f"/api/rfqs/{rfq['id']}/bids"
    await client.post(url, json=bid_body(sup[0]["id"]))  # 5 -> 10, full extension: no capped entry
    d = await details(client, rfq["id"])
    assert acts(d, "EXTENSION_CAPPED") == []
    await client.post(url, json=bid_body(sup[1]["id"], f=900))  # 10 -> 12 (partial cap)
    d = await details(client, rfq["id"])
    [c] = acts(d, "EXTENSION_CAPPED")
    m = json.loads(c["metadata"])
    assert m["requestedMinutes"] == 5 and 1.9 < m["grantedMinutes"] < 2.1 and m["fullyCapped"] is False
    assert "capped by forced close time" in c["message"] and "Bid received" in c["message"]
    assert len(acts(d, "EXTENDED")) == 2  # existing EXTENDED entry is still written
    r = await client.post(url, json=bid_body(sup[2]["id"], f=800))  # already at forced close: fully capped
    assert r.status_code == 201 and r.json()["extension"]["extend"] is False
    d = await details(client, rfq["id"])
    caps = acts(d, "EXTENSION_CAPPED")
    assert len(caps) == 2 and json.loads(caps[0]["metadata"])["fullyCapped"] is True
    assert "blocked" in caps[0]["message"] and "granted +0 min" in caps[0]["message"]
    assert len(acts(d, "EXTENDED")) == 2 and d["extensionCount"] == 2


async def test_close_task(client, clean_db, monkeypatch):
    await suppliers(client)
    published: list[str] = []
    monkeypatch.setattr(worker, "publish_external", lambda i: published.append(i) or True)
    closed = await make_rfq(client, ref="C-1")
    forced = await make_rfq(client, ref="C-2")
    active = await make_rfq(client, ref="C-3")
    n = now()
    with psycopg.connect(clean_db, autocommit=True) as c:
        c.execute('UPDATE "Rfq" SET "bidStartTime"=%s, "bidCloseTime"=%s, "currentCloseTime"=%s, "forcedCloseTime"=%s WHERE id=%s',
                  (n - timedelta(hours=2), n - timedelta(hours=1), n - timedelta(hours=1), n - timedelta(minutes=30), closed["id"]))
        c.execute('UPDATE "Rfq" SET "bidStartTime"=%s, "bidCloseTime"=%s, "currentCloseTime"=%s, "forcedCloseTime"=%s, "extensionCount"=3 WHERE id=%s',
                  (n - timedelta(hours=2), n - timedelta(hours=1), n - timedelta(minutes=10), n - timedelta(minutes=10), forced["id"]))
    seeded_due = set()
    with psycopg.connect(clean_db) as c:  # the dev seed also contains already-closed auctions
        seeded_due = {r[0] for r in c.execute('SELECT id FROM "Rfq" WHERE "currentCloseTime" <= now() AND "referenceId" NOT LIKE %s', ("C-%",))}

    ids = await asyncio.to_thread(worker.close_due_auctions_task)  # the Celery task body, run directly
    assert set(ids) == {closed["id"], forced["id"]} | seeded_due and sorted(published) == sorted(ids)
    d1, d2, d3 = [await details(client, x["id"]) for x in (closed, forced, active)]
    assert d1["status"] == "CLOSED" and len(acts(d1, "AUCTION_CLOSED")) == 1 and acts(d1, "AUCTION_FORCE_CLOSED") == []
    assert d2["status"] == "FORCE_CLOSED" and len(acts(d2, "AUCTION_FORCE_CLOSED")) == 1
    assert "after" not in acts(d1, "AUCTION_CLOSED")[0]["message"]
    assert d3["status"] == "ACTIVE" and acts(d3, "AUCTION_CLOSED") == []

    # Idempotent: a second run (and a concurrent pair) closes nothing and writes no new log entries
    again = await asyncio.gather(asyncio.to_thread(worker.close_due_auctions_task), asyncio.to_thread(worker.close_due_auctions_task))
    assert again == [[], []]
    assert len(acts(await details(client, closed["id"]), "AUCTION_CLOSED")) == 1
    with psycopg.connect(clean_db) as c:
        assert c.execute('SELECT "closedStatus" FROM "Rfq" WHERE id=%s', (forced["id"],)).fetchone()[0] == "FORCE_CLOSED"
