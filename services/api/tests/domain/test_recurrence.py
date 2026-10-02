from datetime import UTC, date, datetime, time, timedelta

import pytest

from kairos.domain.events import EventSeries, OccurrenceState, RecurrenceRule
from kairos.domain.identity import occurrence_id
from kairos.domain.recurrence import NeedsDSTPolicy, expand_slots, materialize


def series(rule: RecurrenceRule, zone: str = "Asia/Shanghai") -> EventSeries:
    start = datetime(2026, 3, 2, 0, tzinfo=UTC)
    return EventSeries("evt_1", "local", 1, "课", None, zone, start, start + timedelta(hours=1), rule)


def test_weekly_slots_use_local_dates() -> None:
    rule = RecurrenceRule("weekly", date(2026, 3, 2), date(2026, 3, 31), (1, 3), time(8), time(9, 40))
    slots = expand_slots(series(rule), datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 3, 9, tzinfo=UTC))
    assert [slot.original_slot for slot in slots] == ["2026-03-02", "2026-03-04"]
    assert slots[0].start_at == datetime(2026, 3, 2, 0, tzinfo=UTC)


def test_cross_midnight_uses_end_day_offset() -> None:
    rule = RecurrenceRule("daily", date(2026, 3, 2), date(2026, 3, 2), (), time(23), time(1), end_day_offset=1)
    (slot,) = expand_slots(series(rule), datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 3, 4, tzinfo=UTC))
    assert slot.end_at - slot.start_at == timedelta(hours=2)


def test_dst_gap_requires_explicit_policy() -> None:
    rule = RecurrenceRule("daily", date(2026, 3, 8), date(2026, 3, 8), (), time(2, 30), time(3, 30))
    window = (datetime(2026, 3, 7, tzinfo=UTC), datetime(2026, 3, 10, tzinfo=UTC))
    with pytest.raises(NeedsDSTPolicy):
        expand_slots(series(rule, "America/New_York"), *window)
    skip = RecurrenceRule("daily", date(2026, 3, 8), date(2026, 3, 8), (), time(2, 30), time(3, 30), gap_policy="skip")
    assert expand_slots(series(skip, "America/New_York"), *window) == []


def test_dst_fold_policy_picks_offset() -> None:
    window = (datetime(2026, 10, 31, tzinfo=UTC), datetime(2026, 11, 3, tzinfo=UTC))
    early = RecurrenceRule("daily", date(2026, 11, 1), date(2026, 11, 1), (), time(1, 30), time(1, 45),
                           fold_policy="earlier")
    (slot,) = expand_slots(series(early, "America/New_York"), *window)
    assert slot.start_at == datetime(2026, 11, 1, 5, 30, tzinfo=UTC)


def test_materialize_overlays_one_instance_only() -> None:
    rule = RecurrenceRule("daily", date(2026, 3, 2), date(2026, 3, 4), (), time(8), time(9))
    first = occurrence_id("evt_1", "2026-03-02")
    items = materialize([series(rule)], {first: OccurrenceState(first, 2, "excused")},
                        datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 3, 6, tzinfo=UTC))
    assert [(item.version, item.disposition) for item in items] == [(2, "excused"), (1, "scheduled"),
                                                                     (1, "scheduled")]


def test_identity_is_stable_and_slot_specific() -> None:
    assert occurrence_id("evt_1", "2026-03-02") == occurrence_id("evt_1", "2026-03-02")
    assert occurrence_id("evt_1", "2026-03-02") != occurrence_id("evt_1", "2026-03-03")
    with pytest.raises(ValueError):
        occurrence_id("evt_1", "")


def test_rule_rejects_open_or_inverted_ranges() -> None:
    with pytest.raises(ValueError):
        RecurrenceRule("daily", date(2026, 3, 4), date(2026, 3, 2), (), time(8), time(9))
    with pytest.raises(ValueError):
        RecurrenceRule("weekly", date(2026, 3, 2), date(2026, 3, 4), (), time(8), time(9))
