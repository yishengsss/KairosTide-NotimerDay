"""Proposals that act on a saved event: change, cancel, excuse. Validation only — nothing is written here.

The same stance as the create path: the model decides what the user meant, the server only refuses.
Four extra refusals apply (M2.5 plan §2.2):

1. The target must be an instance the model looked up in this very turn, so it cannot act on an ID
   it remembered, guessed or was fed in a quotation.
2. A whole-series proposal on a recurring event needs the user's own words for "all of them". Without
   them it is refused, never quietly narrowed to one instance, so the scope on the card is always the
   scope the user said.
3. A new clock time needs a clock time or a shift ("推迟一小时") in the quoted words. Moving only the
   date keeps the clock time the user already saw, so it needs no extra basis.
4. Sentences about changes naturally contain 「取消」「不去」, so the create-path denial veto would block
   every one of them. Here only a *negated action* (「别取消」「不用请假」) and hypotheticals are refused.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from kairos.domain.draft import DraftFields, DraftKind, DraftTarget, Scope, parse_fields
from kairos.domain.events import EventSeries, Occurrence
from kairos.domain.identity import occurrence_id
from kairos.domain.recurrence import MAX_MOVE, Slot, occurrence_at, slot_for, zone_of

from ..ports import UnitOfWork
from . import tools as whitelist

KIND_BY_TOOL: Mapping[str, DraftKind] = {
    whitelist.PROPOSE_EVENT_CHANGE: "change",
    whitelist.PROPOSE_EVENT_CANCEL: "cancel",
    whitelist.PROPOSE_EVENT_EXCUSE: "excuse",
}

_ACTION = r"(?:取消|删|去掉|改|换|挪|推迟|延后|提前|请假|请个假)"
_NEGATED_ACTION = re.compile(rf"(?:别|不要|不用|不必|无需|先不|暂不|没必要)(?:再|帮我|给我|去)?{_ACTION}"
                             r"|当我没说|没事了|never mind", re.IGNORECASE)
_HYPOTHETICAL = re.compile(r"如果|假如|假设|比如说?|举个例子|示例|要是|万一|would you|what if", re.IGNORECASE)
_SERIES_WORDS = re.compile(r"以后|往后|今后|每周|每次|每天|所有|全部|全都|整个|系列|都不|再也")
_SHIFT = re.compile(r"(?:推迟|延后|延迟|顺延|提前|往后推|往前挪|往后挪|晚|早)"
                    r"(?:[0-9零〇一二两三四五六七八九十]{1,3}|半)个?(?:分钟|小时|钟头)")


@dataclass(frozen=True)
class Proposal:
    kind: DraftKind
    fields: DraftFields
    target: DraftTarget


@dataclass(frozen=True)
class Located:
    series: EventSeries
    slot: Slot
    occurrence: Occurrence


def veto_reason(text: str) -> str | None:
    spoken = whitelist.normalize(whitelist.without_quotations(text))
    if _NEGATED_ACTION.search(spoken):
        return "用户这句话是在说不要做这个改动"
    if _HYPOTHETICAL.search(spoken):
        return "用户只是在假设或举例"
    return None


def says_whole_series(fragments: Sequence[str]) -> bool:
    return any(_SERIES_WORDS.search(whitelist.normalize(item)) for item in fragments)


def says_time_change(fragments: Sequence[str]) -> bool:
    return any(whitelist.says_clock_time(item) or _SHIFT.search(whitelist.normalize(item)) for item in fragments)


def locate(uow: UnitOfWork, owner_id: str, event_id: str, original_slot: str) -> Located | None:
    """The current state of one instance, read straight from storage."""
    series = uow.events.get_series(owner_id, event_id)
    if series is None:
        return None
    slot = slot_for(series, original_slot)
    if slot is None:
        return None
    state = uow.occurrences.states(owner_id).get(occurrence_id(event_id, original_slot))
    return Located(series, slot, occurrence_at(series, slot, state))


def propose(uow: UnitOfWork, owner_id: str, tool: str, args: Mapping[str, Any], fragments: Sequence[str],
            queried: Mapping[str, tuple[str, str]]) -> tuple[Proposal | None, str | None]:
    """Build the draft content for a change tool call, or say why not.

    `queried` maps occurrence IDs returned by this turn's lookups to (event_id, original_slot).
    """
    kind = KIND_BY_TOOL[tool]
    identity = args.get("occurrence_id")
    if not isinstance(identity, str) or identity not in queried:
        return None, "只能改动本轮用 query_rigid_events 查到的日程，请先查询再提出"
    event_id, original_slot = queried[identity]
    found = locate(uow, owner_id, event_id, original_slot)
    if found is None:
        return None, "这条日程已经不存在了"
    series, occurrence = found.series, found.occurrence
    recurring = series.recurrence is not None
    if kind == "excuse" and args.get("scope") == "series":
        return None, "请假只作用于这一次，不能对整个系列请假"
    scope: Scope = "series" if args.get("scope") == "series" and recurring else "occurrence"
    if scope == "series" and not says_whole_series(fragments):
        return None, "用户没有明确说要改动整个系列。默认只动这一次；如果用户要动整个系列，请先问清楚"
    if scope == "occurrence" and occurrence.disposition != "scheduled":
        return None, "这一次已经请假、错过或删除了"
    fields = DraftFields(occurrence.title, series.timezone, occurrence.start_at, occurrence.end_at,
                         occurrence.location)
    if kind == "change":
        changed, problem = _changed_fields(args, fields, found, scope, fragments)
        if changed is None:
            return None, problem
        fields = changed
    target = DraftTarget(
        occurrence_id=occurrence.occurrence_id, event_id=series.event_id, original_slot=original_slot,
        scope=scope, recurring=recurring, occurrence_version=occurrence.version, series_version=series.version,
        title=occurrence.title, location=occurrence.location, start_at=occurrence.start_at,
        end_at=occurrence.end_at)
    return Proposal(kind, fields, target), None


def _changed_fields(args: Mapping[str, Any], before: DraftFields, found: Located, scope: Scope,
                    fragments: Sequence[str]) -> tuple[DraftFields | None, str | None]:
    parsed, problems = parse_fields({key: args.get(key) for key in ("title", "location", "start_at", "end_at")})
    if problems:
        return None, "；".join(problems)
    assert before.start_at is not None and before.end_at is not None
    start = parsed.start_at or before.start_at
    # Moving only the start keeps the length the user already has.
    end = parsed.end_at if parsed.end_at is not None else start + (before.end_at - before.start_at)
    if end <= start:
        return None, "结束时间必须晚于开始时间"
    after = DraftFields(parsed.title or before.title, before.timezone, start, end, parsed.location or before.location)
    if after == before:
        return None, "没有要改的内容。请只填写用户要改的字段"
    retimed = (start, end) != (before.start_at, before.end_at)
    if retimed and scope == "series":
        return None, "整个系列目前只能改标题和地点，不能改时间。可以建议用户删掉整个系列后重新新建"
    if retimed and found.series.recurrence is not None and \
            max(abs(start - found.slot.start_at), abs(end - found.slot.end_at)) > MAX_MOVE:
        return None, "单独一次最多挪动 14 天。挪得更远时，请建议用户删掉这一次再新建"
    if retimed and _clock_moved(before, after) and not says_time_change(fragments):
        return None, ("新的时刻没有出现在引用的话里。请把用户说出新时刻或「推迟一小时」这类说法的那段原话摘进 "
                      "basis_phrases；用户没说新时刻就不要填 start_at、end_at，改为提问")
    return after, None


def _clock_moved(before: DraftFields, after: DraftFields) -> bool:
    """Whether the local clock time changed. Moving to another day at the same time is not a new time."""
    assert before.timezone and before.start_at and before.end_at and after.start_at and after.end_at
    zone = zone_of(before.timezone)

    def clock(value: datetime) -> tuple[int, int]:
        local = value.astimezone(zone)
        return local.hour, local.minute

    return (clock(after.start_at), clock(after.end_at)) != (clock(before.start_at), clock(before.end_at))
