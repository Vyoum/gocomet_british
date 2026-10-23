"""Demo role rules (X-Role / X-Supplier headers). Not authentication — see README."""
from tests.test_api import bid_body, make_rfq, suppliers

BUYER = {"X-Role": "buyer"}


def sup(name):
    return {"X-Role": "supplier", "X-Supplier": name}


async def test_supplier_cannot_create_rfq(client):
    r = await client.post("/api/rfqs", json={}, headers=sup("Maersk Line"))
    assert r.status_code == 403 and r.json()["error"] == "Suppliers cannot create RFQs"


async def test_buyer_can_create_rfq(client):
    client.headers.update(BUYER)
    try:
        await make_rfq(client, ref="R-B")
    finally:
        client.headers.pop("X-Role")


async def test_supplier_cannot_bid_as_other_carrier(client):
    ss = await suppliers(client)
    rfq = await make_rfq(client, ref="R-1")
    r = await client.post(f"/api/rfqs/{rfq['id']}/bids", json=bid_body(ss[0]["id"]), headers=sup(ss[1]["name"]))
    assert r.status_code == 403 and "themselves" in r.json()["error"]
    assert (await client.get(f"/api/rfqs/{rfq['id']}")).json()["allBids"] == []


async def test_supplier_bid_as_self_ok_and_sees_own_rank(client):
    ss = await suppliers(client)
    rfq = await make_rfq(client, ref="R-2")
    await client.post(f"/api/rfqs/{rfq['id']}/bids", json=bid_body(ss[0]["id"], f=500))
    r = await client.post(f"/api/rfqs/{rfq['id']}/bids", json=bid_body(ss[1]["id"]), headers=sup(ss[1]["name"].upper()))
    assert r.status_code == 201 and r.json()["rank"] == 2
    lst = (await client.get("/api/rfqs", headers=sup(ss[1]["name"]))).json()["rfqs"]
    assert next(x for x in lst if x["id"] == rfq["id"])["myRank"] == 2
    none = (await client.get("/api/rfqs", headers=sup("Nobody Freight"))).json()["rfqs"]
    assert next(x for x in none if x["id"] == rfq["id"])["myRank"] is None


async def test_buyer_cannot_bid(client):
    ss = await suppliers(client)
    rfq = await make_rfq(client, ref="R-3")
    r = await client.post(f"/api/rfqs/{rfq['id']}/bids", json=bid_body(ss[0]["id"]), headers=BUYER)
    assert r.status_code == 403 and r.json()["error"] == "Buyers cannot submit bids"


async def test_no_header_is_legacy_behaviour(client):
    ss = await suppliers(client)
    rfq = await make_rfq(client, ref="R-4")  # create without headers
    r = await client.post(f"/api/rfqs/{rfq['id']}/bids", json=bid_body(ss[2]["id"]))
    assert r.status_code == 201
    lst = (await client.get("/api/rfqs")).json()["rfqs"]
    assert all("myRank" not in x for x in lst)


async def test_bad_role_headers_rejected(client):
    assert (await client.get("/api/rfqs", headers={"X-Role": "admin"})).status_code == 400
    assert (await client.get("/api/rfqs", headers={"X-Role": "supplier"})).status_code == 400


async def test_ensure_supplier_get_or_create(client):
    a = await client.post("/api/suppliers", json={"name": "  Acme   Cargo "})
    assert a.status_code == 200 and a.json()["name"] == "Acme Cargo"
    b = await client.post("/api/suppliers", json={"name": "acme cargo"})
    assert b.json()["id"] == a.json()["id"]
    assert (await client.post("/api/suppliers", json={"name": ""})).status_code == 400
