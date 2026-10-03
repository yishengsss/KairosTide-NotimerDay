"""Draft facts: what the user is being asked to confirm, and when it stops being confirmable.

A draft is immutable. Editing means a new draft and a `superseded` old row, which removes every
in-place race and lets the digest of the shown content guard the commit. Only `status` moves.

Nothing in this module decides *whether* the user meant to create something — that is the model's
job. It only decides whether the fields the model produced are sufficient, and refuses to invent the
ones that are missing. There is deliberately no default clock time anywhere in this file.
"""

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from .events import RecurrenceRule
from .tasks import Precision, TaskTarget

DraftStatus = Literal["needs_clarification", "ready", "committed", "superseded", "discarded"]
# create: a new event. change / cancel / excuse: act on one saved instance or, when the user said so, its series.
# task_*: the same three moves on a flexible task, which has a title and maybe a deadline but no slot.
DraftKind = Literal["create", "change", "cancel", "excuse", "task_create", "task_change", "task_cancel"]
TASK_KINDS: tuple[DraftKind, ...] = ("task_create", "task_change", "task_cancel")
Scope = Literal["occurrence", "series"]

# Long enough that a user who walks away and comes back can still confirm, short enough that a stale
# draft cannot be committed tomorrow by a stray click.
DRAFT_TTL = timedelta(hours=24)

MAX_TITLE = 120
MAX_LOCATION = 200
MAX_BASIS_PHRASE = 500


@dataclass(frozen=True)
class DraftFields:
    """The candidate event. `None` means "the user has not told us yet", never "pick something"."""

    title: str | None
    timezone: str | None
    start_at: datetime | None
    end_at: datetime | None
    location: str | None = None
    recurrence: RecurrenceRule | None = None
    deadline: datetime | None = None
    precision: Precision | None = None

    def missing(self, kind: "DraftKind" = "create") -> tuple[str, ...]:
        """Which fields the user still has to supply. A flexible task only needs a title."""
        absent: list[str] = []
        if not self.title:
            absent.append("title")
        if not self.timezone:
            absent.append("timezone")
        if kind in TASK_KINDS:
            return tuple(absent)
        if self.start_at is None:
            absent.append("start_at")
        if self.end_at is None:
            absent.append("end_at")
        return tuple(absent)

    def to_json(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "timezone": self.timezone,
            "start_at": self.start_at.isoformat() if self.start_at else None,
            "end_at": self.end_at.isoformat() if self.end_at else None,
            "location": self.location,
            "recurrence": _recurrence_json(self.recurrence),
            "deadline": self.deadline.isoformat() if self.deadline else None,
            "precision": self.precision,
        }


def _recurrence_json(rule: RecurrenceRule | None) -> dict[str, Any] | None:
    if rule is None:
        return None
    return {
        "frequency": rule.frequency,
        "starts_on": rule.starts_on.isoformat(),
        "ends_on": rule.ends_on.isoformat(),
        "weekdays": list(rule.weekdays),
        "local_start": rule.local_start.isoformat(),
        "local_end": rule.local_end.isoformat(),
        "end_day_offset": rule.end_day_offset,
        "gap_policy": rule.gap_policy,
        "fold_policy": rule.fold_policy,
    }


def _recurrence_from_json(raw: Mapping[str, Any]) -> RecurrenceRule:
    from datetime import date, time

    return RecurrenceRule(
        frequency=raw["frequency"],
        starts_on=date.fromisoformat(raw["starts_on"]),
        ends_on=date.fromisoformat(raw["ends_on"]),
        weekdays=tuple(int(day) for day in raw["weekdays"]),
        local_start=time.fromisoformat(raw["local_start"]),
        local_end=time.fromisoformat(raw["local_end"]),
        end_day_offset=int(raw.get("end_day_offset", 0)),
        gap_policy=raw.get("gap_policy"),
        fold_policy=raw.get("fold_policy"),
    )


def parse_fields(raw: Mapping[str, Any]) -> tuple[DraftFields, tuple[str, ...]]:
    """Read the model's candidate leniently. Returns (fields, problems).

    A value that cannot be understood is reported as a problem and left unset, so the assistant asks
    the user again instead of substituting a plausible-looking guess.
    """
    problems: list[str] = []
    title = _text(raw.get("title"), MAX_TITLE)
    if raw.get("title") and title is None:
        problems.append("标题无法使用，请重新给出 1..120 字的标题")
    location = _text(raw.get("location"), MAX_LOCATION)
    timezone = _text(raw.get("timezone"), 64)
    if timezone is not None and not _valid_timezone(timezone):
        problems.append(f"时区 {timezone!r} 无法识别，请给出 IANA 时区名")
        timezone = None
    start_at = _moment(raw.get("start_at"), "开始时间", problems)
    end_at = _moment(raw.get("end_at"), "结束时间", problems)
    if start_at and end_at and end_at <= start_at:
        problems.append("结束时间必须晚于开始时间")
        end_at = None
    recurrence = None
    if isinstance(raw.get("recurrence"), Mapping):
        try:
            recurrence = _recurrence_from_json(raw["recurrence"])
        except (KeyError, TypeError, ValueError):
            problems.append("重复规则不完整：需要频率、起止日期，每周还需星期几与开始/结束时刻")
    deadline, precision = _deadline(raw, problems)
    return DraftFields(title, timezone, start_at, end_at, location, recurrence, deadline, precision), \
        tuple(problems)


def _deadline(raw: Mapping[str, Any], problems: list[str]) -> tuple[datetime | None, Precision | None]:
    """A deadline and its precision travel together: without the precision we cannot show it back."""
    deadline = _moment(raw.get("deadline"), "截止时间", problems)
    precision = raw.get("precision")
    if deadline is None:
        if precision is not None:
            problems.append("只给了截止精度却没有截止时间")
        return None, None
    if precision not in ("date", "instant"):
        problems.append("截止时间需要说明精度：用户只说到某天用 date，说了具体时刻用 instant")
        return None, None
    return deadline, precision


def _text(value: object, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped[:limit] if stripped else None


def _valid_timezone(name: str) -> bool:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def _moment(value: object, label: str, problems: list[str]) -> datetime | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        problems.append(f"{label}格式无法识别")
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        problems.append(f"{label}格式无法识别，请给出 ISO 8601 时间")
        return None
    if parsed.tzinfo is None:
        problems.append(f"{label}必须带时区偏移")
        return None
    return parsed.astimezone(UTC)


@dataclass(frozen=True)
class DraftTarget:
    """The saved instance a change draft acts on, as the user was shown it when the draft was made.

    Commit compares both versions against storage, so a change built on a stale view is refused
    rather than applied over whatever happened in between.
    """

    occurrence_id: str
    event_id: str
    original_slot: str
    scope: Scope
    recurring: bool
    occurrence_version: int
    series_version: int
    title: str
    location: str | None
    start_at: datetime
    end_at: datetime

    def to_json(self) -> dict[str, Any]:
        return {"occurrence_id": self.occurrence_id, "event_id": self.event_id,
                "original_slot": self.original_slot, "scope": self.scope,
                "recurring": self.recurring, "occurrence_version": self.occurrence_version,
                "series_version": self.series_version, "title": self.title, "location": self.location,
                "start_at": self.start_at.isoformat(), "end_at": self.end_at.isoformat()}

    @staticmethod
    def from_json(raw: Mapping[str, Any]) -> "DraftTarget":
        return DraftTarget(
            occurrence_id=raw["occurrence_id"], event_id=raw["event_id"], original_slot=raw["original_slot"],
            scope=raw["scope"],
            recurring=bool(raw["recurring"]), occurrence_version=int(raw["occurrence_version"]),
            series_version=int(raw["series_version"]), title=raw["title"], location=raw.get("location"),
            start_at=datetime.fromisoformat(raw["start_at"]), end_at=datetime.fromisoformat(raw["end_at"]))


# A change draft points at either a saved occurrence or a saved flexible task.
Target = DraftTarget | TaskTarget


def target_from_json(raw: Mapping[str, Any]) -> Target:
    return TaskTarget.from_json(dict(raw)) if "task_id" in raw else DraftTarget.from_json(raw)


def initial_status(fields: DraftFields, kind: DraftKind = "create") -> DraftStatus:
    return "needs_clarification" if fields.missing(kind) else "ready"


@dataclass(frozen=True)
class Draft:
    """A persisted draft row. Content is fixed; only `status` and its two pointers move."""

    draft_id: str
    owner_id: str
    conversation_id: str
    source_message_id: str
    status: DraftStatus
    digest: str
    anchor_at: datetime
    expires_at: datetime
    basis_phrase: str
    fields: DraftFields
    created_at: datetime
    updated_at: datetime
    superseded_by: str | None = None
    committed_event_id: str | None = None
    kind: DraftKind = "create"
    target: Target | None = None

    def expired(self, now: datetime) -> bool:
        return now >= self.expires_at

    def confirmable(self, now: datetime) -> bool:
        return self.status == "ready" and not self.expired(now)

    def to_json(self) -> dict[str, Any]:
        """What the client holds. The digest is included so a confirmation can carry it back."""
        return {
            "draft_id": self.draft_id,
            "conversation_id": self.conversation_id,
            "status": self.status,
            "digest": self.digest,
            "fields": self.fields.to_json(),
            "missing": list(self.fields.missing(self.kind)),
            "basis_phrase": self.basis_phrase,
            "anchor_at": self.anchor_at.isoformat(),
            "expires_at": self.expires_at.isoformat(),
            "superseded_by": self.superseded_by,
            "committed_event_id": self.committed_event_id,
            "kind": self.kind,
            "target": self.target.to_json() if self.target else None,
        }

    def fields_json(self) -> str:
        return json.dumps(self.fields.to_json(), sort_keys=True, ensure_ascii=False)


def fields_from_json(raw: Mapping[str, Any]) -> DraftFields:
    return DraftFields(
        title=raw.get("title"),
        timezone=raw.get("timezone"),
        start_at=datetime.fromisoformat(raw["start_at"]) if raw.get("start_at") else None,
        end_at=datetime.fromisoformat(raw["end_at"]) if raw.get("end_at") else None,
        location=raw.get("location"),
        recurrence=_recurrence_from_json(raw["recurrence"]) if raw.get("recurrence") else None,
        deadline=datetime.fromisoformat(raw["deadline"]) if raw.get("deadline") else None,
        precision=raw.get("precision"),
    )


def compute_digest(draft_id: str, fields: DraftFields, basis_phrase: str, kind: DraftKind = "create",
                   target: Target | None = None) -> str:
    """Digest of exactly what the user was shown. Confirmations carry it, so a tampered or stale copy
    cannot be committed even if it reaches the endpoint. Kind and target are part of it, so the scope
    of a change cannot be swapped after the user saw the card."""
    content: dict[str, Any] = {"draft_id": draft_id, "fields": fields.to_json(), "basis": basis_phrase}
    if kind != "create":
        content["kind"] = kind
        content["target"] = target.to_json() if target else None
    payload = json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()


def acceptance_token(digest: str, slots: Sequence[tuple[str, str]], existing: Mapping[str, int]) -> str:
    """Hash of the conflict snapshot the user is accepting.

    The token pins the candidate slots *and* the versions of every instance overlapping them. If
    anything joins the same window while the user is deciding, the token stops matching and the
    review has to happen again, so an acceptance can never be applied to a schedule it never saw.
    """
    existing_occurrence_ids = sorted(existing.items())
    payload = json.dumps({"digest": digest, "slots": sorted(slots),
                          "existing": existing_occurrence_ids}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()
