"""The M2.5 refusals that look at the user's words. They only ever withhold an action."""

import pytest

from kairos.application.assistant import changes


@pytest.mark.parametrize("text", [
    "先别取消组会", "不要删明天的课", "不用请假了", "算了当我没说", "如果我取消高数课会怎样"])
def test_negated_or_hypothetical_actions_are_vetoed(text: str) -> None:
    assert changes.veto_reason(text) is not None


@pytest.mark.parametrize("text", ["明天的组会取消", "高数课以后都不上了", "今天高数课请假", "把组会改到四点",
                                  "我说的「别取消」是别人的话，帮我取消组会"])
def test_plain_requests_pass(text: str) -> None:
    assert changes.veto_reason(text) is None


@pytest.mark.parametrize(("fragments", "expected"), [
    (["高数课取消"], False), (["明天的高数课取消"], False), (["高数课以后都不上了"], True),
    (["每周的高数课都换到教五"], True), (["整个系列删掉"], True)])
def test_whole_series_needs_its_own_words(fragments: list[str], expected: bool) -> None:
    assert changes.says_whole_series(fragments) is expected


@pytest.mark.parametrize(("fragments", "expected"), [
    (["改到四点"], True), (["推迟一小时"], True), (["提前半小时"], True),
    (["往后挪一挪"], False), (["改个时间"], False)])
def test_a_new_time_needs_a_clock_or_a_shift(fragments: list[str], expected: bool) -> None:
    assert changes.says_time_change(fragments) is expected
