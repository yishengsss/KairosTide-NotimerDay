"""Run a write once per (owner, operation, key); replay the stored result for identical retries."""

import json
from collections.abc import Callable
from hashlib import sha256
from typing import Any

from .errors import IdempotencyMismatch, InvalidRequest
from .ports import StoredResult, UnitOfWork


def request_hash(payload: dict[str, Any]) -> str:
    return sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def once(uow: UnitOfWork, owner_id: str, operation: str, key: str, payload: dict[str, Any],
         action: Callable[[], dict[str, Any]], at: Any) -> dict[str, Any]:
    if not key or len(key) > 128:
        raise InvalidRequest("Idempotency-Key must be 1..128 characters")
    digest = request_hash(payload)
    previous = uow.idempotency.get(owner_id, operation, key)
    if previous is not None:
        if previous.request_hash != digest:
            raise IdempotencyMismatch("this Idempotency-Key was used for a different request")
        return previous.result
    result = action()
    uow.idempotency.put(owner_id, operation, key, StoredResult(digest, result), at)
    return result
