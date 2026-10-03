"""The basis check: quoted fragments must come from the user, and a time on the card must be quoted."""

from datetime import UTC, datetime
from typing import Any

import pytest

from kairos.application.assistant import tools
from kairos.domain.draft import DraftFields

SAID = ["今天下午两点到三点开组会", "8:30 上课", "3pm meeting", "十点半", "半小时后提醒我",
        "20分钟以后", "明天早八", "九點"]
UNSAID = ["提醒我开会", "明天开组会", "在图书馆", "下周三", "中午吃饭", "第一二节课"]


@pytest.mark.parametrize("text", SAID)
def test_clock_times_the_user_said_are_recognised(text: str) -> None:
    assert tools.says_clock_time(text)


@pytest.mark.parametrize("text", UNSAID)
def test_sentences_without_a_clock_time_are_not(text: str) -> None:
    assert not tools.says_clock_time(text)


def timed() -> DraftFields:
    start = datetime(2026, 10, 13, 6, tzinfo=UTC)
    return DraftFields("组会", "Asia/Shanghai", start, start.replace(hour=7))


def test_a_timed_draft_needs_a_fragment_that_states_the_time() -> None:
    assert tools.time_basis_problem(timed(), ["提醒我开会"]) is not None
    assert tools.time_basis_problem(timed(), ["提醒我开会", "明天下午两点到三点"]) is None


def test_an_untimed_draft_needs_no_time_fragment() -> None:
    assert tools.time_basis_problem(DraftFields("组会", "Asia/Shanghai", None, None), ["提醒我开会"]) is None


def test_every_fragment_is_traced_to_the_user() -> None:
    said = ["提醒我开会", "明天下午两点到三点，在图书馆"]
    assert tools.fragments_problem(["提醒我开会", "明天下午两点到三点"], said) is None
    assert tools.fragments_problem(["提醒我开会", "后天上午九点"], said) is not None


def test_fragments_are_read_from_either_shape() -> None:
    assert tools.basis_fragments({"basis_phrases": ["a", " b "]}) == (("a", "b"), None)
    assert tools.basis_fragments({"basis_phrase": "a"}) == (("a",), None)
    shapes: tuple[dict[str, Any], ...] = ({}, {"basis_phrases": []}, {"basis_phrases": [" "]}, {"basis_phrases": [1]},
                {"basis_phrases": ["a"] * (tools.MAX_BASIS_FRAGMENTS + 1)})
    for bad in shapes:
        assert tools.basis_fragments(bad)[0] is None
