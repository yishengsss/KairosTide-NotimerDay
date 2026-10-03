"""M3: flexible task facts. Lifecycle, derived urgency, and the deadline precision."""

from datetime import UTC, date, datetime, timedelta

import pytest

from kairos.domain.tasks import (
    FlexibleTask,
    normalized_title,
    resolve_deadline,
    urgency,
    valid_transition,
)

NOW = datetime(2026, 10, 12, 1, 0, tzinfo=UTC)  # Monday 09:00 Asia/Shanghai
ZONE = "Asia/Shanghai"


def task(deadline: datetime | None = None, lifecycle: str = "planned") -> FlexibleTask:
    return FlexibleTask("t1", "local", 1, "操作系统实验", ZONE, lifecycle,  # type: ignore[arg-type]
                        deadline, "date" if deadline else None)


def test_a_task_needs_a_title() -> None:
    with pytest.raises(ValueError):
        FlexibleTask("t1", "local", 1, "", ZONE, "planned")


def test_a_deadline_and_its_precision_travel_together() -> None:
    with pytest.raises(ValueError):
        FlexibleTask("t1", "local", 1, "背单词", ZONE, "planned", NOW, None)
    with pytest.raises(ValueError):
        FlexibleTask("t1", "local", 1, "背单词", ZONE, "planned", None, "date")


def test_before_a_day_means_the_end_of_that_local_day() -> None:
    resolved = resolve_deadline(date(2026, 10, 18), ZONE)
    assert resolved == datetime(2026, 10, 18, 15, 59, 59, tzinfo=UTC)  # 23:59:59 local


def test_normalized_title_ignores_spacing_and_case() -> None:
    assert normalized_title("背 单词") == normalized_title("背单词")
    assert normalized_title("Lab Report") == normalized_title("labreport")


def test_the_lifecycle_the_user_drives() -> None:
    assert valid_transition("planned", "active")  # accept
    assert valid_transition("active", "planned")  # pause
    assert valid_transition("active", "done")
    assert valid_transition("planned", "done")  # the user just says it is finished
    assert valid_transition("done", "active")  # undo a completion
    assert not valid_transition("done", "planned")  # undo lands on active, never back in the pool
    assert not valid_transition("planned", "planned")


def test_urgency_is_derived_in_the_users_own_timezone() -> None:
    assert urgency(task(), NOW) == "none"
    assert urgency(task(NOW + timedelta(hours=2)), NOW) == "today"
    assert urgency(task(NOW + timedelta(days=2)), NOW) == "soon"
    assert urgency(task(NOW + timedelta(days=9)), NOW) == "later"
    assert urgency(task(NOW - timedelta(hours=1)), NOW) == "overdue"


def test_an_overdue_task_is_kept_and_still_shows() -> None:
    overdue = task(NOW - timedelta(days=3))
    assert overdue.overdue(NOW) and overdue.lifecycle == "planned"
    assert overdue.shows_in_scene()


def test_a_done_task_leaves_the_scene() -> None:
    assert not task(lifecycle="done").shows_in_scene()
    assert task(lifecycle="active").shows_in_scene()
