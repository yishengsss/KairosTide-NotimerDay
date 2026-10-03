"""Batch drafts (M4 §2.2): everything recognised in one image, shown on one card.

Each item is a candidate event or flexible task with its own quoted line from the image. The user
ticks which ones to keep; only those are written. An item that is not complete is still shown, so the
user sees what was read, but it cannot be selected.
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from .draft import DraftFields, fields_from_json

ItemKind = Literal["create", "task_create"]
MAX_BATCH_ITEMS = 20


@dataclass(frozen=True)
class BatchItem:
    kind: ItemKind
    fields: DraftFields
    basis: str

    @property
    def missing(self) -> tuple[str, ...]:
        return self.fields.missing(self.kind)

    @property
    def selectable(self) -> bool:
        return not self.missing

    def to_json(self) -> dict[str, Any]:
        return {"kind": self.kind, "fields": self.fields.to_json(), "basis": self.basis,
                "missing": list(self.missing)}


def items_json(items: Sequence[BatchItem]) -> str:
    return json.dumps([item.to_json() for item in items], sort_keys=True, ensure_ascii=False)


def items_from_json(raw: str | None) -> tuple[BatchItem, ...]:
    if not raw:
        return ()
    loaded: list[Mapping[str, Any]] = json.loads(raw)
    return tuple(BatchItem(item["kind"], fields_from_json(item["fields"]), item["basis"]) for item in loaded)


def item_key(draft_id: str, index: int) -> str:
    """Seed for an item's deterministic event or task ID, so a replayed commit lands on the same rows."""
    return f"{draft_id}#{index}"
