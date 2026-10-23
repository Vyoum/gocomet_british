from datetime import datetime, timedelta, timezone

from app.auction import (
    ExtensionInput,
    SimpleBid,
    evaluate_extension,
    get_status,
    is_in_trigger_window,
    rank_bids,
    ranking_order,
    validate_rfq_times,
)


def T(hhmm: str) -> datetime:
    h, m = map(int, hhmm.split(":"))
    return datetime(2026, 10, 22, h, m, tzinfo=timezone.utc)


CLOSE, FORCED = T("18:00"), T("18:30")


def ext(trigger, bid_time, before, after, current=CLOSE):
    return evaluate_extension(
        ExtensionInput(trigger, 10, 5, current, FORCED, bid_time, before, after)
    )


def test_ranking_latest_bid_per_supplier_sorted_asc():
    r = rank_bids([SimpleBid("A", 100, T("17:00")), SimpleBid("B", 90, T("17:01")), SimpleBid("A", 80, T("17:02"))])
    assert [(b.supplier_id, rank, b.total_price) for rank, b in r] == [("A", 1, 80), ("B", 2, 90)]


def test_ranking_ties_broken_by_earliest_bid():
    assert ranking_order([SimpleBid("B", 50, T("17:05")), SimpleBid("A", 50, T("17:01"))]) == ["A", "B"]


def test_trigger_window_is_half_open():
    assert not is_in_trigger_window(CLOSE, 10, T("17:49"))
    assert is_in_trigger_window(CLOSE, 10, T("17:50"))
    assert is_in_trigger_window(CLOSE, 10, T("17:59"))
    assert not is_in_trigger_window(CLOSE, 10, T("18:00"))


def test_bid_received_extends_on_any_bid_in_window():
    d = ext("BID_RECEIVED", T("17:55"), ["A"], ["A", "B"])
    assert d.extend and d.new_close_time == T("18:05")


def test_bid_received_extends_without_rank_change():
    assert ext("BID_RECEIVED", T("17:55"), ["A", "B"], ["A", "B"]).extend


def test_bid_received_not_outside_window():
    assert not ext("BID_RECEIVED", T("17:40"), [], ["A"]).extend


def test_window_uses_already_extended_close():
    d = ext("BID_RECEIVED", T("18:02"), ["A"], ["A"], current=T("18:05"))
    assert d.new_close_time == T("18:10")


def test_any_rank_change_on_reorder():
    assert ext("ANY_RANK_CHANGE", T("17:55"), ["A", "B", "C"], ["A", "C", "B"]).extend


def test_any_rank_change_on_new_supplier():
    assert ext("ANY_RANK_CHANGE", T("17:55"), ["A"], ["A", "B"]).extend


def test_any_rank_change_not_when_unchanged():
    assert not ext("ANY_RANK_CHANGE", T("17:55"), ["A", "B"], ["A", "B"]).extend


def test_l1_change_extends_on_new_l1():
    assert ext("L1_CHANGE", T("17:55"), ["A", "B"], ["B", "A"]).extend


def test_l1_change_ignores_lower_rank_changes():
    assert not ext("L1_CHANGE", T("17:55"), ["A", "B", "C"], ["A", "C", "B"]).extend


def test_l1_change_first_bid_counts():
    assert ext("L1_CHANGE", T("17:55"), [], ["A"]).extend


def test_l1_lowering_own_price_does_not_extend():
    assert not ext("L1_CHANGE", T("17:55"), ["A", "B"], ["A", "B"]).extend


def test_extension_capped_at_forced_close():
    d = ext("BID_RECEIVED", T("18:27"), [], ["A"], current=T("18:28"))
    assert d.extend and d.new_close_time == FORCED and d.capped_at_forced_close
    assert d.reason.endswith("(capped at forced close time)")


def test_no_extension_at_forced_close():
    assert not ext("BID_RECEIVED", T("18:29"), [], ["A"], current=FORCED).extend


def test_statuses():
    s = T("17:00")
    assert get_status(s, CLOSE, FORCED, T("16:59")) == "UPCOMING"
    assert get_status(s, CLOSE, FORCED, T("17:30")) == "ACTIVE"
    assert get_status(s, CLOSE, FORCED, T("18:00")) == "CLOSED"
    assert get_status(s, FORCED, FORCED, T("18:30")) == "FORCE_CLOSED"


def test_validate_rfq_times():
    assert validate_rfq_times(T("17:00"), CLOSE, FORCED, 10, 5) == []
    assert len(validate_rfq_times(T("17:00"), CLOSE, CLOSE, 10, 5)) == 1
    assert len(validate_rfq_times(T("18:00"), T("17:00"), FORCED, 0, 5)) == 2


def test_reason_texts():
    assert ext("BID_RECEIVED", T("17:55"), [], ["A"]).reason == "Bid received from a supplier within last 10 min; extended by 5 min"


def test_trigger_at_forced_close_is_fully_capped():
    d = ext("BID_RECEIVED", T("18:29"), [], ["A"], current=FORCED)
    assert not d.extend and d.triggered and d.capped_at_forced_close and d.granted_minutes == 0


def test_partial_cap_reports_granted_minutes():
    d = ext("BID_RECEIVED", T("18:27"), [], ["A"], current=FORCED - timedelta(minutes=2))
    assert d.extend and d.triggered and d.granted_minutes == 2
