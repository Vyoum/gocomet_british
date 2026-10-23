from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.money import from_minor, to_minor
from app.schemas import BidIn, RfqIn

FUTURE = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
BID = dict(supplierId="s1", freightCharges=1000.5, originCharges="150.25", destinationCharges=0.1, transitTimeDays=5, quoteValidUntil=FUTURE)
RFQ = dict(
    referenceId="R1", name="n", bidStartTime="2026-10-22T10:00:00Z", bidCloseTime="2026-10-22T18:00:00Z",
    forcedCloseTime="2026-10-22T18:30:00Z", pickupDate="2026-10-30T00:00:00Z", triggerWindowMinutes="10",
    extensionMinutes=5, triggerType="L1_CHANGE",
)


def ok(model, data) -> bool:
    try:
        model.model_validate(data)
        return True
    except ValidationError:
        return False


def test_money_minor_units_without_float_drift():
    assert to_minor(0.1) + to_minor(0.2) == 30
    assert to_minor(1150.75) == 115075
    assert from_minor(115075) == 1150.75


def test_bid_schema_stores_minor_units():
    b = BidIn.model_validate(BID)
    assert [b.freightCharges, b.originCharges, b.destinationCharges] == [100050, 15025, 10]


def test_rejects_3dp_and_negatives():
    assert not ok(BidIn, {**BID, "freightCharges": 1.005})
    assert not ok(BidIn, {**BID, "freightCharges": -1})


def test_rejects_total_zero():
    assert not ok(BidIn, {**BID, "freightCharges": 0, "originCharges": 0, "destinationCharges": 0})


def test_accepts_numeric_strings():
    assert RfqIn.model_validate(RFQ).triggerWindowMinutes == 10


@pytest.mark.parametrize("v", ["", None, "  ", "abc", True])
def test_rejects_bad_numbers(v):
    assert not ok(BidIn, {**BID, "freightCharges": v})
    assert not ok(RfqIn, {**RFQ, "triggerWindowMinutes": v})


@pytest.mark.parametrize("v", ["", None, "not-a-date"])
def test_rejects_bad_dates(v):
    assert not ok(RfqIn, {**RFQ, "bidStartTime": v})
    assert not ok(BidIn, {**BID, "quoteValidUntil": v})


def test_rejects_unknown_trigger_type():
    assert not ok(RfqIn, {**RFQ, "triggerType": "NOPE"})


def test_epoch_ms_dates():
    r = RfqIn.model_validate({**RFQ, "bidStartTime": 1792663200000})
    assert r.bidStartTime == datetime.fromtimestamp(1792663200, tz=timezone.utc)
