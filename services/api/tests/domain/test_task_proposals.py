"""M3 Wave 1A: the task proposal validators. Pure checks, no storage for the create path."""

from kairos.application.assistant.task_proposals import (
    CREATE_TASK_DRAFT,
    propose_create,
)


def test_create_keeps_a_date_deadline() -> None:
    args = {"title": "操作系统实验", "timezone": "Asia/Shanghai",
            "deadline": "2026-10-18T15:59:59+00:00", "precision": "date"}
    proposal, problem = propose_create(args, ("周日前完成操作系统实验",))
    assert problem is None and proposal is not None
    assert proposal.kind == "task_create"
    assert proposal.fields.precision == "date"
    assert proposal.target is None


def test_instant_deadline_needs_a_clock_time_in_the_quote() -> None:
    args = {"title": "交实验报告", "timezone": "Asia/Shanghai",
            "deadline": "2026-10-16T10:00:00+00:00", "precision": "instant"}
    # The quoted words name only a day, not a clock time.
    proposal, problem = propose_create(args, ("周五前交实验报告",))
    assert proposal is None and problem is not None and "instant" in problem


def test_instant_deadline_passes_with_a_clock_time() -> None:
    args = {"title": "交实验报告", "timezone": "Asia/Shanghai",
            "deadline": "2026-10-16T10:00:00+00:00", "precision": "instant"}
    proposal, problem = propose_create(args, ("周五下午六点前交实验报告",))
    assert problem is None and proposal is not None
    assert proposal.fields.precision == "instant"


def test_create_without_a_deadline_keeps_only_a_title() -> None:
    proposal, problem = propose_create({"title": "高数习题", "timezone": "Asia/Shanghai"},
                                       ("下周把高数习题做完",))
    assert problem is None and proposal is not None
    assert proposal.fields.deadline is None and proposal.fields.precision is None


def test_the_create_tool_name_maps_to_task_create() -> None:
    from kairos.application.assistant.task_proposals import KIND_BY_TOOL

    assert KIND_BY_TOOL[CREATE_TASK_DRAFT] == "task_create"
