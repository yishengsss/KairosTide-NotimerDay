"""Occurrence identity is derived from the series and its immutable original slot.

Provenance: KairosTide domain/occurrence_identity.py @7babbaa (same namespace, so IDs stay stable).
"""

from uuid import NAMESPACE_URL, uuid5


def occurrence_id(event_id: str, original_slot: str) -> str:
    if not event_id or not original_slot:
        raise ValueError("event and immutable slot required")
    return f"occ_{uuid5(NAMESPACE_URL, f'kairos/{event_id}/{original_slot}').hex}"
