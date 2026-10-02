"""Normalize WMO weather codes and measurements into scene intensities (0..1).

The mapping is a proposal for M1; only real observations ever produce rain, snow or fog.
"""

from dataclasses import dataclass
from typing import Literal

Condition = Literal["clear", "partly_cloudy", "overcast", "fog", "drizzle", "rain", "snow", "thunderstorm"]


@dataclass(frozen=True)
class SceneWeather:
    condition: Condition
    cloud: float
    rain: float
    snow: float
    fog: float
    wind: float
    thunder: bool


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def condition_for(code: int) -> Condition:
    if code in (0, 1):
        return "clear"
    if code == 2:
        return "partly_cloudy"
    if code == 3:
        return "overcast"
    if code in (45, 48):
        return "fog"
    if 51 <= code <= 57:
        return "drizzle"
    if 61 <= code <= 67 or 80 <= code <= 82:
        return "rain"
    if 71 <= code <= 77 or code in (85, 86):
        return "snow"
    if 95 <= code <= 99:
        return "thunderstorm"
    raise ValueError(f"unknown WMO weather code {code}")


_BASE_RAIN = {51: .2, 53: .3, 55: .4, 56: .25, 57: .4, 61: .4, 63: .65, 65: .9, 66: .45, 67: .85,
              80: .45, 81: .7, 82: 1.0, 95: .75, 96: .85, 99: 1.0}
_BASE_SNOW = {71: .35, 73: .6, 75: .9, 77: .25, 85: .5, 86: .85}


def normalize(code: int, cloud_cover_pct: float | None, precipitation_mm: float | None,
              visibility_m: float | None, wind_speed_ms: float | None) -> SceneWeather:
    condition = condition_for(code)
    cloud = _clamp((cloud_cover_pct if cloud_cover_pct is not None else
                    {"clear": 5.0, "partly_cloudy": 45.0}.get(condition, 95.0)) / 100)
    rain = _BASE_RAIN.get(code, 0.0)
    snow = _BASE_SNOW.get(code, 0.0)
    if precipitation_mm is not None and (rain or snow):
        # Measured intensity refines the code: ~4 mm/h reads as heavy on screen.
        measured = _clamp(0.25 + precipitation_mm / 4)
        rain = rain and _clamp((rain + measured) / 2)
        snow = snow and _clamp((snow + measured) / 2)
    fog = 0.0
    if condition == "fog":
        fog = 0.9
    elif visibility_m is not None and visibility_m < 2000:
        fog = _clamp((2000 - visibility_m) / 1600)
    wind = _clamp((wind_speed_ms or 0.0) / 15)
    return SceneWeather(condition=condition, cloud=round(cloud, 3), rain=round(rain, 3), snow=round(snow, 3),
                        fog=round(fog, 3), wind=round(wind, 3), thunder=condition == "thunderstorm")
