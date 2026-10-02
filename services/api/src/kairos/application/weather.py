"""Scene weather by coordinates, cached briefly. Failure is reported as unavailable, never as clear sky."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from threading import Lock
from typing import Literal, Protocol

from kairos.domain.weather import SceneWeather, normalize

from .errors import InvalidRequest, UpstreamUnavailable
from .ports import Clock

CACHE_TTL = timedelta(minutes=10)


@dataclass(frozen=True)
class RawObservation:
    weather_code: int
    cloud_cover: float | None
    precipitation: float | None
    visibility: float | None
    wind_speed: float | None
    observed_at: datetime


@dataclass(frozen=True)
class Place:
    name: str
    latitude: float
    longitude: float
    timezone: str
    country: str | None
    admin1: str | None


class WeatherProviderError(Exception):
    pass


class WeatherProvider(Protocol):
    source: str
    attribution: str

    def current(self, latitude: float, longitude: float) -> RawObservation: ...
    def search(self, query: str) -> list[Place]: ...


@dataclass(frozen=True)
class SceneWeatherReport:
    availability: Literal["available", "unavailable"]
    weather: SceneWeather | None
    observed_at: datetime | None
    fetched_at: datetime
    source: str
    attribution: str


def _validate(latitude: float, longitude: float) -> tuple[float, float]:
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise InvalidRequest("coordinates out of range")
    # Round to ~1 km so cache keys are shared and precise location is not forwarded upstream.
    return round(latitude, 2), round(longitude, 2)


class WeatherService:
    def __init__(self, provider: WeatherProvider, clock: Clock) -> None:
        self._provider = provider
        self._clock = clock
        self._cache: dict[tuple[float, float], SceneWeatherReport] = {}
        self._lock = Lock()

    def scene(self, latitude: float, longitude: float) -> SceneWeatherReport:
        key = _validate(latitude, longitude)
        now = self._clock.now()
        with self._lock:
            cached = self._cache.get(key)
        if cached and cached.availability == "available" and now - cached.fetched_at < CACHE_TTL:
            return cached
        try:
            raw = self._provider.current(*key)
            report = SceneWeatherReport(
                "available",
                normalize(raw.weather_code, raw.cloud_cover, raw.precipitation, raw.visibility, raw.wind_speed),
                raw.observed_at, now, self._provider.source, self._provider.attribution)
        except (WeatherProviderError, ValueError):
            return SceneWeatherReport("unavailable", None, None, now, self._provider.source,
                                      self._provider.attribution)
        with self._lock:
            self._cache[key] = report
        return report

    def search(self, query: str) -> list[Place]:
        query = query.strip()
        if not query or len(query) > 80:
            raise InvalidRequest("query must be 1..80 characters")
        try:
            return self._provider.search(query)
        except WeatherProviderError as error:
            # Distinguish "no such place" (empty list) from "could not ask".
            raise UpstreamUnavailable("place search is temporarily unavailable") from error
