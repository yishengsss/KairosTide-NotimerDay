from datetime import UTC, datetime


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class FixedClock:
    """Test and dev clock that only moves when told to."""

    def __init__(self, now: datetime) -> None:
        if now.tzinfo is None:
            raise ValueError("clock time must be timezone aware")
        self.value = now

    def now(self) -> datetime:
        return self.value
