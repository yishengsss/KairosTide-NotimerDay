from datetime import timedelta

from tests.conftest import Harness


def test_weather_is_normalized_and_cached(harness: Harness) -> None:
    first = harness.client.get("/api/v1/weather/scene", params={"lat": 34.2611, "lon": 108.9422}).json()
    assert first["availability"] == "available" and first["weather"]["condition"] == "rain"
    harness.client.get("/api/v1/weather/scene", params={"lat": 34.2649, "lon": 108.9449})
    assert harness.weather.calls == 1
    harness.advance(timedelta(minutes=11))
    harness.client.get("/api/v1/weather/scene", params={"lat": 34.26, "lon": 108.94})
    assert harness.weather.calls == 2


def test_weather_failure_is_unavailable_not_clear(harness: Harness) -> None:
    harness.weather.fail = True
    body = harness.client.get("/api/v1/weather/scene", params={"lat": 34.26, "lon": 108.94}).json()
    assert body["availability"] == "unavailable" and body["weather"] is None


def test_unknown_weather_code_is_unavailable(harness: Harness) -> None:
    harness.weather.code = 42
    body = harness.client.get("/api/v1/weather/scene", params={"lat": 34.26, "lon": 108.94}).json()
    assert body["availability"] == "unavailable"


def test_coordinates_are_validated(harness: Harness) -> None:
    response = harness.client.get("/api/v1/weather/scene", params={"lat": 120, "lon": 0})
    assert response.status_code == 422 and response.json()["error"]["code"] == "INVALID_REQUEST"


def test_place_search_and_upstream_failure(harness: Harness) -> None:
    assert harness.client.get("/api/v1/places", params={"q": "西安"}).json()["items"][0]["timezone"] == "Asia/Shanghai"
    harness.weather.fail = True
    response = harness.client.get("/api/v1/places", params={"q": "西安"})
    assert response.status_code == 503 and response.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"


def test_health(harness: Harness) -> None:
    assert harness.client.get("/api/v1/health").json() == {"status": "ok"}
