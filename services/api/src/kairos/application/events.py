"""Create rigid event series. In M1 this is reachable only from the dev CLI; M2 adds confirmed drafts."""

from datetime import datetime
from uuid import uuid4

from kairos.domain.events import EventSeries, RecurrenceRule
from kairos.domain.recurrence import zone_of

from .errors import InvalidRequest
from .ports import Clock, UnitOfWorkFactory


class EventService:
    def __init__(self, uow: UnitOfWorkFactory, clock: Clock) -> None:
        self._uow = uow
        self._clock = clock

    def create(self, owner_id: str, title: str, location: str | None, timezone: str, start_at: datetime,
               end_at: datetime, recurrence: RecurrenceRule | None = None) -> EventSeries:
        title = title.strip()
        if not title or len(title) > 120:
            raise InvalidRequest("title must be 1..120 characters")
        if start_at.tzinfo is None or end_at.tzinfo is None or end_at <= start_at:
            raise InvalidRequest("event needs aware start before end")
        try:
            zone_of(timezone)
        except ValueError as error:
            raise InvalidRequest(str(error)) from error
        series = EventSeries(event_id=f"evt_{uuid4().hex}", owner_id=owner_id, version=1, title=title,
                             location=(location or "").strip() or None, timezone=timezone,
                             start_at=start_at, end_at=end_at, recurrence=recurrence)
        with self._uow(write=True) as uow:
            uow.events.add_series(series, self._clock.now())
            uow.audit.record(owner_id, "event_created", series.event_id, self._clock.now())
            uow.commit()
        return series
