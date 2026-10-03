"""The image-import tool (M4 §2.2): every item read from one image goes on one batch draft.

Offered only on a turn that carries an image, and only when the user asked to import. Each item quotes
the line of the image it came from; the image is the basis, so the quote is not checked against the
user's words. Items are parsed as strictly as single drafts: anything unreadable stays unset and the
item is shown as incomplete instead of guessed.
"""

import re
from collections.abc import Mapping, Sequence
from typing import Any

from kairos.domain.batch import MAX_BATCH_ITEMS, BatchItem
from kairos.domain.draft import MAX_BASIS_PHRASE, parse_fields

from ..ports import UnitOfWork
from .model import ToolSchema

IMPORT_FROM_IMAGE = "import_from_image"

# The user asked to bring things in, or said yes to the assistant's offer. A bare "这是什么" is not it.
_IMPORT_INTENT = re.compile(r"导入|添加|加到|加进|加上|存|记下|记到|记一下|放进|放到|录入|整理|安排|"
                            r"好的?|可以|行|嗯|是的|ok|yes", re.IGNORECASE)

_ITEM = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["event", "task"],
                 "description": "event：有固定开始和结束时刻；task：没有固定时刻、要抽空完成的事"},
        "title": {"type": "string"},
        "location": {"type": "string", "description": "图上写了地点才填"},
        "start_at": {"type": "string", "description": "event 才填，ISO 8601 带时区偏移"},
        "end_at": {"type": "string", "description": "event 才填，ISO 8601 带时区偏移"},
        "deadline": {"type": "string", "description": "task 才填，图上写了截止才填"},
        "precision": {"type": "string", "enum": ["date", "instant"]},
        "basis": {"type": "string", "description": "图上对应这一条的文字，原样摘抄"},
    },
    "required": ["kind", "title", "basis"],
}

IMPORT_SCHEMA = ToolSchema(
    name=IMPORT_FROM_IMAGE,
    description=("把用户这轮发来的图片里识别出的日程和待办，整理成一张可勾选的批量草稿。只有用户明确要导入或"
                 "同意你导入时才用；用户只是问图里有什么时，照实描述，并问要不要导入。图上看不清的时刻、"
                 "日期不要猜，留空，那一条会显示为待补全。一张图只调用一次，把所有条目放进 items。"),
    parameters={"type": "object", "properties": {
        "timezone": {"type": "string", "description": "IANA 时区名"},
        "items": {"type": "array", "minItems": 1, "maxItems": MAX_BATCH_ITEMS, "items": _ITEM}},
        "required": ["items"]},
)


def import_intent(text: str) -> bool:
    return bool(_IMPORT_INTENT.search(text))


def parse_items(args: Mapping[str, Any], timezone: str) -> tuple[tuple[BatchItem, ...], str | None]:
    raw = args.get("items")
    if not isinstance(raw, list) or not raw:
        return (), "items 必须是非空列表"
    if len(raw) > MAX_BATCH_ITEMS:
        return (), f"一次最多导入 {MAX_BATCH_ITEMS} 条"
    zone = args.get("timezone") if isinstance(args.get("timezone"), str) else timezone
    items: list[BatchItem] = []
    for index, entry in enumerate(raw, 1):
        if not isinstance(entry, Mapping):
            return (), f"第 {index} 条不是对象"
        basis = entry.get("basis")
        if not isinstance(basis, str) or not basis.strip():
            return (), f"第 {index} 条缺少 basis（图上对应的原文）"
        task = entry.get("kind") == "task"
        allowed = ("title", "deadline", "precision") if task else ("title", "location", "start_at", "end_at")
        fields, _problems = parse_fields({"timezone": zone, **{key: entry.get(key) for key in allowed}})
        items.append(BatchItem("task_create" if task else "create", fields, basis.strip()[:MAX_BASIS_PHRASE]))
    return tuple(items), None


def preview_conflicts(uow: UnitOfWork, owner_id: str, items: Sequence[BatchItem]) -> list[dict[str, Any]]:
    """Read-only: which saved events overlap each complete event item. Told to the model, never resolved."""
    from kairos.domain.recurrence import materialize
    from kairos.domain.time_rules import overlaps

    spans = [(index, item.fields) for index, item in enumerate(items)
             if item.kind == "create" and item.selectable]
    if not spans:
        return []
    start = min(fields.start_at for _, fields in spans if fields.start_at)
    end = max(fields.end_at for _, fields in spans if fields.end_at)
    saved = [item for item in materialize(uow.events.list_series(owner_id), uow.occurrences.states(owner_id),
                                          start, end) if item.disposition == "scheduled"]
    found: list[dict[str, Any]] = []
    for index, fields in spans:
        assert fields.start_at and fields.end_at
        for other in saved:
            if overlaps(fields.start_at, fields.end_at, other.start_at, other.end_at):
                found.append({"item": index, "overlaps": other.title, "start_at": other.start_at.isoformat()})
    return found


def plan_import(uow: UnitOfWork, owner_id: str, args: Mapping[str, Any], timezone: str, offered: bool
                ) -> tuple[tuple[BatchItem, ...], Any]:
    """Items plus what to tell the model, or no items plus why not."""
    from .prompts import batch_notice

    if not offered:
        return (), "用户没有要求导入，先描述图片并问要不要导入"
    items, problem = parse_items(args, timezone)
    if problem is not None:
        return (), problem
    return items, {"notice": batch_notice(items), "conflicts": preview_conflicts(uow, owner_id, items)}
