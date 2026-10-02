from datetime import UTC, datetime, timedelta

from kairos.domain.conflicts import conflict_groups, state_revision
from kairos.domain.events import Disposition, Occurrence
from kairos.domain.schedule_state import project

NOW = datetime(2026, 10, 12, 1, 0, tzinfo=UTC)


def occ(identity: str, start_min: int, length_min: int = 30, version: int = 1,
        disposition: Disposition = "scheduled") -> Occurrence:
    start = NOW + timedelta(minutes=start_min)
    return Occurrence(identity, "evt", "local", "single", start, start + timedelta(minutes=length_min), identity,
                      None, version, disposition)


def test_reminder_window_is_exclusive_of_start_and_inclusive_of_lead() -> None:
    state = project([occ("a", 5), occ("b", 6), occ("c", 0)], set(), NOW)
    assert [item.occurrence_id for item in state.reminders] == ["a"]
    assert [item.occurrence_id for item in state.active] == ["c"]


def test_acknowledged_version_hides_reminder_but_new_version_reappears() -> None:
    assert project([occ("a", 3)], {("a", 1)}, NOW).reminders == ()
    assert len(project([occ("a", 3, version=2)], {("a", 1)}, NOW).reminders) == 1


def test_excused_or_missed_are_neither_active_nor_reminded() -> None:
    state = project([occ("a", 3, disposition="excused"), occ("b", -1, disposition="missed")], set(), NOW)
    assert state.active == () and state.reminders == ()


def test_next_transition_is_earliest_boundary() -> None:
    state = project([occ("a", 12), occ("b", -10, 15)], set(), NOW)
    assert state.next_transition_at == NOW + timedelta(minutes=5)  # b ends
    assert project([occ("a", 12)], set(), NOW).next_transition_at == NOW + timedelta(minutes=7)  # a reminder
    assert project([], set(), NOW).next_transition_at is None


def test_conflict_groups_are_connected_components() -> None:
    a, b, c, d = occ("a", -10, 30), occ("b", -5, 10), occ("c", 3, 30), occ("d", 100)
    assert conflict_groups([a, b, c, d]) == (("a", "b", "c"),)


def test_revision_changes_with_version_and_is_js_safe() -> None:
    first = state_revision([occ("a", -1)])
    assert first != state_revision([occ("a", -1, version=2)])
    assert 0 <= first < 2**53
