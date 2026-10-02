"""Conflict grouping and a stable revision of the active set. Detection never decides attendance.

Provenance: KairosTide domain/conflicts.py + domain/attention.py @7babbaa. Changed: revision hashes
version + disposition only (schedule_revision removed).
"""

from collections.abc import Iterable
from hashlib import sha256

from .events import Occurrence
from .time_rules import overlaps


def conflict_pairs(occurrences: Iterable[Occurrence]) -> tuple[tuple[str, str], ...]:
    items = [item for item in occurrences if item.disposition == "scheduled"]
    found: set[tuple[str, str]] = set()
    for index, item in enumerate(items):
        for other in items[index + 1:]:
            if item.occurrence_id != other.occurrence_id and overlaps(
                item.start_at, item.end_at, other.start_at, other.end_at
            ):
                left, right = sorted((item.occurrence_id, other.occurrence_id))
                found.add((left, right))
    return tuple(sorted(found))


def conflict_groups(active: Iterable[Occurrence]) -> tuple[tuple[str, ...], ...]:
    edges = conflict_pairs(active)
    neighbors: dict[str, set[str]] = {identity: set() for edge in edges for identity in edge}
    for left, right in edges:
        neighbors[left].add(right)
        neighbors[right].add(left)
    groups: list[tuple[str, ...]] = []
    remaining = set(neighbors)
    while remaining:
        pending = [min(remaining)]
        component: set[str] = set()
        while pending:
            identity = pending.pop()
            if identity in component:
                continue
            component.add(identity)
            pending.extend(neighbors[identity] - component)
        remaining -= component
        groups.append(tuple(sorted(component)))
    return tuple(sorted(groups))


def state_revision(active: Iterable[Occurrence]) -> int:
    canonical = "\n".join(
        "|".join((item.occurrence_id, str(item.version), item.start_at.isoformat(),
                  item.end_at.isoformat(), item.disposition))
        for item in sorted(active, key=lambda value: value.occurrence_id)
    )
    # Stay within JavaScript's exact 53-bit integer range.
    return int.from_bytes(sha256(canonical.encode()).digest()[:6], "big")
