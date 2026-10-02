from typing import Annotated

from fastapi import APIRouter, Query

from .. import dto
from ..deps import ServicesDep

router = APIRouter(tags=["environment"])


@router.get("/weather/scene", response_model=dto.SceneWeather, responses={422: {"model": dto.ErrorResponse}})
def scene_weather(lat: Annotated[float, Query(ge=-90, le=90)], lon: Annotated[float, Query(ge=-180, le=180)],
                  svc: ServicesDep) -> dto.SceneWeather:
    report = svc.weather.scene(lat, lon)
    values = None
    if report.weather is not None:
        w = report.weather
        values = dto.SceneWeatherValues(condition=w.condition, cloud=w.cloud, rain=w.rain, snow=w.snow, fog=w.fog,
                                        wind=w.wind, thunder=w.thunder)
    return dto.SceneWeather(availability=report.availability, weather=values, observed_at=report.observed_at,
                            fetched_at=report.fetched_at, source=report.source, attribution=report.attribution)


@router.get("/places", response_model=dto.PlaceList,
            responses={422: {"model": dto.ErrorResponse}, 503: {"model": dto.ErrorResponse}})
def places(q: Annotated[str, Query(min_length=1, max_length=80)], svc: ServicesDep) -> dto.PlaceList:
    return dto.PlaceList(items=[dto.Place(name=p.name, latitude=p.latitude, longitude=p.longitude,
                                          timezone=p.timezone, country=p.country, admin1=p.admin1)
                                for p in svc.weather.search(q)])
