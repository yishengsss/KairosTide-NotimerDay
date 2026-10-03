"""The two read-only tools. Neither writes, so a query can never become an action."""

from datetime import datetime
from typing import Any

from kairos.domain.recurrence import materialize
from kairos.domain.tasks import urgency

from ..errors import InvalidRequest, UpstreamUnavailable
from ..ports import UnitOfWork
from ..weather import WeatherService
from . import tools as whitelist
from .conversation_types import ToolOutcome
from .task_tools import QUERY_FLEXIBLE_TASKS


def query_events(uow: UnitOfWork, owner_id: str, args: dict[str, Any], now: datetime
                 ) -> tuple[ToolOutcome, dict[str, tuple[str, str]]]:
    """The outcome, plus what was seen: occurrence ID → (event ID, slot). Only those may be changed this turn."""
    window, problem = whitelist.parse_window(args, now)
    if window is None:
        return ToolOutcome(whitelist.QUERY_RIGID_EVENTS, "rejected", problem or "查询窗口无效"), {}
    series = uow.events.list_series(owner_id)
    recurring = {item.event_id for item in series if item.recurrence is not None}
    items = materialize(series, uow.occurrences.states(owner_id), window.start, window.end)
    data = [{"occurrence_id": item.occurrence_id, "event_id": item.event_id, "title": item.title,
             "location": item.location, "start_at": item.start_at.isoformat(),
             "end_at": item.end_at.isoformat(), "disposition": item.disposition,
             "recurring": item.event_id in recurring} for item in items]
    seen = {item.occurrence_id: (item.event_id, item.original_slot) for item in items}
    return ToolOutcome(whitelist.QUERY_RIGID_EVENTS, "ok", data), seen


def query_tasks(uow: UnitOfWork, owner_id: str, now: datetime
                ) -> tuple[ToolOutcome, dict[str, int]]:
    """The outcome, plus what was seen: task ID → version. Only those may be changed this turn (rule 5)."""
    tasks = uow.tasks.list_tasks(owner_id)
    data = [{"task_id": task.task_id, "title": task.title, "lifecycle": task.lifecycle,
             "deadline": task.deadline.isoformat() if task.deadline else None,
             "precision": task.precision, "urgency": urgency(task, now),
             "overdue": task.overdue(now)} for task in tasks]
    seen = {task.task_id: task.version for task in tasks}
    return ToolOutcome(QUERY_FLEXIBLE_TASKS, "ok", data), seen


def query_weather(weather: WeatherService | None, args: dict[str, Any]) -> ToolOutcome:
    """Answers carry source and observation time. A city lookup is never remembered as a default place."""
    city = args.get("city")
    if not isinstance(city, str) or not city.strip():
        return ToolOutcome(whitelist.QUERY_WEATHER, "rejected", "没有给出城市")
    if weather is None:
        return ToolOutcome(whitelist.QUERY_WEATHER, "unavailable", "天气查询不可用")
    try:
        places = weather.search(city.strip())
    except InvalidRequest as error:
        return ToolOutcome(whitelist.QUERY_WEATHER, "rejected", error.message)
    except UpstreamUnavailable:  # provider down: report it, never claim a sky
        return ToolOutcome(whitelist.QUERY_WEATHER, "unavailable", "天气源暂时不可用")
    if not places:
        return ToolOutcome(whitelist.QUERY_WEATHER, "rejected", f"没有找到 {city}")
    if len(places) > 1:
        return ToolOutcome(whitelist.QUERY_WEATHER, "clarify",
                           [{"name": place.name, "admin1": place.admin1, "country": place.country}
                            for place in places[:5]])
    place = places[0]
    report = weather.scene(place.latitude, place.longitude)
    if report.weather is None:
        return ToolOutcome(whitelist.QUERY_WEATHER, "unavailable", "天气源暂时不可用")
    return ToolOutcome(whitelist.QUERY_WEATHER, "ok", {
        "place": place.name, "condition": report.weather.condition,
        "observed_at": report.observed_at.isoformat() if report.observed_at else None,
        "source": report.source, "attribution": report.attribution, "fetched_at": report.fetched_at.isoformat()})
