"""Open-Meteo current weather + geocoding (non-commercial prototype use, CC BY 4.0).

Provenance: endpoint choice and validation ideas from KairosTide adapters/weather/open_meteo.py @7babbaa;
rewritten for coordinate queries with httpx.
"""

from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from kairos.application.weather import Place, RawObservation, WeatherProviderError

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


class OpenMeteoProvider:
    source = "Open-Meteo"
    attribution = "Weather data by Open-Meteo (CC BY 4.0)"

    def __init__(self, client: httpx.Client | None = None, timeout: float = 8.0) -> None:
        self._client = client or httpx.Client(timeout=timeout)

    def _get(self, url: str, params: dict[str, Any]) -> dict[str, Any]:
        try:
            response = self._client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise WeatherProviderError("Open-Meteo request failed") from error
        if not isinstance(data, dict):
            raise WeatherProviderError("unexpected Open-Meteo payload")
        return data

    def current(self, latitude: float, longitude: float) -> RawObservation:
        data = self._get(FORECAST_URL, {
            "latitude": latitude, "longitude": longitude, "timezone": "UTC",
            "current": "weather_code,cloud_cover,precipitation,visibility,wind_speed_10m",
            "wind_speed_unit": "ms",
        })
        current = data.get("current")
        if not isinstance(current, dict):
            raise WeatherProviderError("missing current block")
        code = current.get("weather_code")
        if isinstance(code, bool) or not isinstance(code, int):
            raise WeatherProviderError("missing weather code")
        raw_time = current.get("time")
        try:
            observed = datetime.fromisoformat(str(raw_time)).replace(tzinfo=UTC)
        except ValueError as error:
            raise WeatherProviderError("invalid observation time") from error
        return RawObservation(code, _number(current.get("cloud_cover")), _number(current.get("precipitation")),
                              _number(current.get("visibility")), _number(current.get("wind_speed_10m")), observed)

    def search(self, query: str) -> list[Place]:
        data = self._get(GEOCODING_URL, {"name": query, "count": 8, "language": "zh", "format": "json"})
        places: list[Place] = []
        for item in data.get("results") or []:
            if not isinstance(item, dict):
                continue
            lat, lon, zone = _number(item.get("latitude")), _number(item.get("longitude")), item.get("timezone")
            name = item.get("name")
            if lat is None or lon is None or not isinstance(name, str) or not isinstance(zone, str):
                continue
            try:
                ZoneInfo(zone)
            except (ZoneInfoNotFoundError, ValueError):
                continue
            country, admin1 = item.get("country"), item.get("admin1")
            places.append(Place(name, lat, lon, zone, country if isinstance(country, str) else None,
                                admin1 if isinstance(admin1, str) else None))
        return places
