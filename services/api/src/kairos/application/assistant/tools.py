"""The whitelist: what the assistant may do, and the checks that stand between a proposal and a write.

Two jobs, kept deliberately narrow.

**Veto, never trigger.** The application layer does not classify the user's sentence — the model
decides what to attempt. What the server does is refuse to act on a sentence that denies, cancels,
hypothesises or merely quotes. This direction matters: a veto can only ever withhold an action, so it
cannot itself invent one. That is the difference between this and the keyword router it replaces.

**Trace the basis.** A write must quote the user. The server checks that the quoted phrase really
appears in what the user typed, so a tool call cannot be justified by words the model made up. This
is a provenance check, not an intent classifier: a phrase that passes may still be a
misunderstanding, which is what the confirmation step is for.

A draft may be assembled over several messages ("提醒我开会" … "明天下午两点到三点"), so its basis is
a list of fragments, each checked on its own. One more veto applies to drafts: if the draft carries a
clock time, at least one fragment must contain a clock time. Otherwise the time on the card would
rest on words the user never said, while the card claimed a basis for it.
"""

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from kairos.application.assistant.limits import MAX_BASIS_FRAGMENTS as MAX_BASIS_FRAGMENTS
from kairos.application.assistant.model import ToolCall, ToolSchema
from kairos.domain.draft import MAX_BASIS_PHRASE, DraftFields, parse_fields

QUERY_RIGID_EVENTS = "query_rigid_events"
QUERY_WEATHER = "query_weather"
CREATE_RIGID_EVENT_DRAFT = "create_rigid_event_draft"
PROPOSE_EVENT_CHANGE = "propose_event_change"
PROPOSE_EVENT_CANCEL = "propose_event_cancel"
PROPOSE_EVENT_EXCUSE = "propose_event_excuse"

READ_TOOLS = frozenset({QUERY_RIGID_EVENTS, QUERY_WEATHER})
CHANGE_TOOLS = frozenset({PROPOSE_EVENT_CHANGE, PROPOSE_EVENT_CANCEL, PROPOSE_EVENT_EXCUSE})
WRITE_TOOLS = frozenset({CREATE_RIGID_EVENT_DRAFT}) | CHANGE_TOOLS
KNOWN_TOOLS = READ_TOOLS | WRITE_TOOLS

MAX_TURN_TOOL_CALLS = 4
MAX_MODEL_ROUNDS = 3
DEFAULT_LOOKUP_DAYS_BEFORE = 1
DEFAULT_LOOKUP_DAYS_AFTER = 14
MAX_LOOKUP_DAYS = 30
BASIS_JOINER = "……"

SCHEMAS: tuple[ToolSchema, ...] = (
    ToolSchema(
        name=QUERY_RIGID_EVENTS,
        description=("只读查询用户自己已保存的固定时间日程。用户主动问起他的安排，或要修改、删除、请假前找到那一条时使用。"
                     f"窗口一次最多 {MAX_LOOKUP_DAYS} 天，不填默认是昨天到两周后。"),
        parameters={
            "type": "object",
            "properties": {
                "start": {"type": "string", "description": "ISO 8601 带时区偏移的窗口开始"},
                "end": {"type": "string", "description": "ISO 8601 带时区偏移的窗口结束"},
                "timezone": {"type": "string", "description": "IANA 时区名，例如 Asia/Shanghai"},
                "basis_phrase": {"type": "string", "description": "用户原话里请求这次查询的片段，原样摘抄"},
            },
            "required": ["basis_phrase"],
        },
    ),
    ToolSchema(
        name=QUERY_WEATHER,
        description="只读查询某个城市的当前天气。用户主动问天气时使用，回答要带来源与观测时间。",
        parameters={
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "用户本轮明确说出的城市名"},
                "timezone": {"type": "string", "description": "IANA 时区名，可省略"},
                "basis_phrase": {"type": "string", "description": "用户原话里请求这次查询的片段，原样摘抄"},
            },
            "required": ["city", "basis_phrase"],
        },
    ),
    ToolSchema(
        name=CREATE_RIGID_EVENT_DRAFT,
        description=(
            "把用户说出的安排整理成一份待确认草稿。这不会创建日程，只生成一份需要用户点"
            "「确认保存」的草稿。时刻、时长、标题、重复范围用户没说就不要填，改用提问。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "用户说出的安排名称，例如 高数课"},
                "location": {"type": "string", "description": "用户说出的地点，没说就不要填"},
                "timezone": {"type": "string", "description": "IANA 时区名"},
                "start_at": {"type": "string", "description": "ISO 8601 带时区偏移的开始时刻"},
                "end_at": {"type": "string", "description": "ISO 8601 带时区偏移的结束时刻"},
                "recurrence": {
                    "type": "object",
                    "description": "每周或每天重复时才有。缺少起止日期时不要填，先问用户。",
                    "properties": {
                        "frequency": {"type": "string", "enum": ["daily", "weekly"]},
                        "starts_on": {"type": "string", "description": "YYYY-MM-DD"},
                        "ends_on": {"type": "string", "description": "YYYY-MM-DD，用户没说就留空"},
                        "weekdays": {"type": "array", "items": {"type": "integer"},
                                     "description": "ISO 星期几，1 是周一"},
                        "local_start": {"type": "string", "description": "HH:MM:SS"},
                        "local_end": {"type": "string", "description": "HH:MM:SS"},
                        "end_day_offset": {"type": "integer", "enum": [0, 1]},
                    },
                    "required": ["frequency", "starts_on", "ends_on", "local_start", "local_end"],
                },
                "basis_phrases": {
                    "type": "array", "minItems": 1, "maxItems": MAX_BASIS_FRAGMENTS,
                    "items": {"type": "string"},
                    "description": ("用户原话里说出这条安排的片段，每段原样摘抄。安排分几句话说完时，"
                                    "每句里相关的部分各摘一段，其中必须包括用户说出时刻的那一段"),
                },
            },
            "required": ["basis_phrases"],
        },
    ),
)

_TARGET = {"type": "string", "description": "本轮 query_rigid_events 结果里那一次日程的 occurrence_id，原样填写"}
_SCOPE = {"type": "string", "enum": ["occurrence", "series"],
          "description": "occurrence 只动这一次（默认）。只有用户明确说了以后、每周、所有、整个系列这类话时才用 series"}
_BASIS = {"type": "array", "minItems": 1, "maxItems": MAX_BASIS_FRAGMENTS, "items": {"type": "string"},
          "description": "用户原话里提出这次改动的片段，每段原样摘抄"}

SCHEMAS = (
    *SCHEMAS,
    ToolSchema(
        name=PROPOSE_EVENT_CHANGE,
        description=("为一条已保存的日程生成一份修改草稿，用户点「确认修改」才会生效。必须先用 query_rigid_events "
                     "查到这条日程。只填用户要改的字段，没提到的不要填。整个系列只能改标题和地点。"),
        parameters={"type": "object", "properties": {
            "occurrence_id": _TARGET, "scope": _SCOPE,
            "title": {"type": "string", "description": "新的标题，用户没说要改就不要填"},
            "location": {"type": "string", "description": "新的地点，用户没说要改就不要填"},
            "start_at": {"type": "string", "description": "新的开始时刻，ISO 8601 带时区偏移"},
            "end_at": {"type": "string", "description": "新的结束时刻，ISO 8601 带时区偏移"},
            "basis_phrases": _BASIS},
            "required": ["occurrence_id", "basis_phrases"]},
    ),
    ToolSchema(
        name=PROPOSE_EVENT_CANCEL,
        description=("为一条已保存的日程生成一份删除草稿，用户点「确认删除」才会生效。必须先用 query_rigid_events "
                     "查到这条日程。重复日程默认只删这一次。"),
        parameters={"type": "object", "properties": {
            "occurrence_id": _TARGET, "scope": _SCOPE, "basis_phrases": _BASIS},
            "required": ["occurrence_id", "basis_phrases"]},
    ),
    ToolSchema(
        name=PROPOSE_EVENT_EXCUSE,
        description=("为一次已保存的日程生成请假草稿，用户点「确认请假」才会生效。请假只作用于这一次，"
                     "不影响以后。必须先用 query_rigid_events 查到这一次。"),
        parameters={"type": "object", "properties": {"occurrence_id": _TARGET, "basis_phrases": _BASIS},
                    "required": ["occurrence_id", "basis_phrases"]},
    ),
)

# Flexible-task tools live in task_tools.py (schemas) and task_proposals.py (validation), imported here
# so the whitelist stays the one place that answers "may the model call this?". The import is late to
# avoid a cycle: task_proposals imports this module for its vetoes and clock-time check.
from .task_proposals import TASK_CHANGE_TOOLS as _TASK_CHANGE  # noqa: E402
from .task_proposals import TASK_WRITE_TOOLS as _TASK_WRITE  # noqa: E402
from .task_tools import TASK_READ_TOOLS as _TASK_READ  # noqa: E402
from .task_tools import TASK_SCHEMAS as _TASK_SCHEMAS  # noqa: E402

SCHEMAS = (*SCHEMAS, *_TASK_SCHEMAS)
READ_TOOLS = READ_TOOLS | _TASK_READ
CHANGE_TOOLS = CHANGE_TOOLS | _TASK_CHANGE
WRITE_TOOLS = WRITE_TOOLS | _TASK_WRITE
KNOWN_TOOLS = READ_TOOLS | WRITE_TOOLS

SCHEMA_BY_NAME: Mapping[str, ToolSchema] = {schema.name: schema for schema in SCHEMAS}

# Vetoes only. Nothing here triggers an action.
_HYPOTHETICAL = re.compile(r"如果|假如|假设|比如说?|举个例子|示例|要是|万一|would you|what if")
_DENIAL = re.compile(r"不要|不用|不需要|别|先不|暂不|取消|算了|没事了|当我没说|not now|never mind")
_QUOTED = re.compile(r"[「『“\"'《][^」』”\"'》]{0,200}[」』”\"'》]")


def normalize(text: str) -> str:
    """Collapse whitespace so a quotation can be matched across line breaks and double spaces."""
    return re.sub(r"\s+", "", text)


def without_quotations(text: str) -> str:
    return _QUOTED.sub("", text)


def veto_reason(text: str) -> str | None:
    """Why this turn must not perform a write, or None. Quoted speech is not the user asking."""
    spoken = without_quotations(text)
    if _DENIAL.search(spoken):
        return "用户这句话里有否定或取消的意思"
    if _HYPOTHETICAL.search(spoken):
        return "用户只是在假设或举例"
    return None


# A clock time the user actually said: 14:00, 3pm, 两点, 十点半, 20分钟后, 半小时后, 早八.
_NUMERAL = r"[0-9０-９零〇一二两三四五六七八九十]{1,3}"
_CLOCK = re.compile(
    rf"\d{{1,2}}\s*[:：]\s*\d{{2}}|\d{{1,2}}\s*(?:am|pm|a\.m\.|p\.m\.)|{_NUMERAL}\s*[点點时時]"
    rf"|(?:{_NUMERAL}|半)\s*个?\s*(?:分钟|小时|钟头)\s*[以之]?后|[早晚]\s*{_NUMERAL}",
    re.IGNORECASE)


def says_clock_time(text: str) -> bool:
    return _CLOCK.search(normalize(text)) is not None


def basis_fragments(args: Mapping[str, Any]) -> tuple[tuple[str, ...] | None, str | None]:
    """The quoted fragments of a draft call. A single `basis_phrase` string is accepted as one fragment."""
    raw = args.get("basis_phrases")
    if raw is None and isinstance(args.get("basis_phrase"), str):
        raw = [args["basis_phrase"]]
    if not isinstance(raw, list) or not raw or not all(isinstance(item, str) for item in raw):
        return None, "缺少 basis_phrases，无法核对依据"
    fragments = tuple(item.strip() for item in raw if item.strip())
    if not fragments:
        return None, "这次操作没有引用用户的原话"
    if len(fragments) > MAX_BASIS_FRAGMENTS:
        return None, f"引用的片段最多 {MAX_BASIS_FRAGMENTS} 段"
    return fragments, None


def fragments_problem(fragments: Sequence[str], user_texts: Sequence[str]) -> str | None:
    for fragment in fragments:
        problem = basis_problem(fragment, user_texts)
        if problem is not None:
            return f"{problem}：「{fragment[:40]}」"
    if len(BASIS_JOINER.join(fragments)) > MAX_BASIS_PHRASE:
        return "引用的话太长，无法核对"
    return None


def time_basis_problem(fields: DraftFields, fragments: Sequence[str]) -> str | None:
    """A draft that carries a time must quote the words where the user said it."""
    if fields.start_at is None and fields.end_at is None and fields.recurrence is None:
        return None
    if any(says_clock_time(fragment) for fragment in fragments):
        return None
    return ("草稿里有时刻，但引用的话里没有用户说出的时刻。请把用户说出时刻的那句话也原样摘进 basis_phrases；"
            "用户没说过时刻就不要填 start_at、end_at，改为提问")


def basis_problem(phrase: str, user_texts: Sequence[str]) -> str | None:
    """Check that a quoted basis really came from the user. None means it did."""
    cleaned = phrase.strip()
    if not cleaned:
        return "这次操作没有引用用户的原话"
    if len(cleaned) > MAX_BASIS_PHRASE:
        return "引用的话太长，无法核对"
    needle = normalize(cleaned)
    for text in user_texts:
        if needle in normalize(text):
            return None
    return "引用的话没有出现在用户的消息里"


def decode_arguments(call: ToolCall) -> tuple[dict[str, Any] | None, str | None]:
    """A tool call whose arguments never parsed is refused, never guessed at."""
    if call.malformed is not None:
        return None, f"参数不是合法的 JSON 对象：{call.malformed}"
    if not isinstance(call.arguments, dict):
        return None, "参数不是对象"
    return call.arguments, None


@dataclass(frozen=True)
class LookupWindow:
    start: datetime
    end: datetime


def resolve_zone(name: object) -> ZoneInfo | None:
    if not isinstance(name, str) or not name.strip():
        return None
    try:
        return ZoneInfo(name.strip())
    except (ZoneInfoNotFoundError, ValueError):
        return None


def parse_window(args: Mapping[str, Any], now: datetime) -> tuple[LookupWindow | None, str | None]:
    """Read an optional window, defaulting to "yesterday through two weeks out"."""
    zone = resolve_zone(args.get("timezone")) or UTC
    start = _moment(args.get("start"))
    end = _moment(args.get("end"))
    if start is None:
        start = now - timedelta(days=DEFAULT_LOOKUP_DAYS_BEFORE)
    if end is None:
        end = now + timedelta(days=DEFAULT_LOOKUP_DAYS_AFTER)
    if end <= start:
        return None, "查询窗口的结束时间必须晚于开始时间"
    if end - start > timedelta(days=MAX_LOOKUP_DAYS):
        return None, f"一次最多查询 {MAX_LOOKUP_DAYS} 天"
    return LookupWindow(start.astimezone(zone), end.astimezone(zone)), None


def _moment(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(UTC)


def parse_draft(args: Mapping[str, Any]) -> tuple[DraftFields, tuple[str, ...]]:
    return parse_fields(args)


def describe_call(call: ToolCall) -> str:
    return f"{call.name}({json.dumps(call.arguments, ensure_ascii=False, sort_keys=True)})"
