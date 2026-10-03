from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from kairos.adapters.clock import FixedClock
from kairos.adapters.sqlite.database import migrate
from kairos.adapters.sqlite.unit_of_work import SqliteUnitOfWorkFactory
from kairos.application.events import EventService
from kairos.application.weather import Place, RawObservation, WeatherProviderError
from kairos.bootstrap import create_app
from kairos.settings import Settings

from .fake_model import FakeModel

NOW = datetime(2026, 10, 12, 1, 0, tzinfo=UTC)  # 09:00 Asia/Shanghai


class FakeWeather:
    source = "fake"
    attribution = "test"

    def __init__(self) -> None:
        self.calls = 0
        self.fail = False
        self.code = 61

    def current(self, latitude: float, longitude: float) -> RawObservation:
        self.calls += 1
        if self.fail:
            raise WeatherProviderError("down")
        return RawObservation(self.code, 80, 1.2, 9000, 4.5, NOW)

    def search(self, query: str) -> list[Place]:
        if self.fail:
            raise WeatherProviderError("down")
        return [Place("西安", 34.26, 108.94, "Asia/Shanghai", "中国", "陕西")]


class Harness:
    def __init__(self, path: Path, with_model: bool = True) -> None:
        self.path = path
        self.clock = FixedClock(NOW)
        self.weather = FakeWeather()
        self.model = FakeModel()
        migrate(path)
        self.client = TestClient(create_app(Settings(path, "local", "127.0.0.1", 0), clock=self.clock,
                                            weather=self.weather, model=self.model if with_model else None))
        self.events = EventService(SqliteUnitOfWorkFactory(path), self.clock)

    def seed(self, start_in: timedelta, minutes: int = 20, title: str = "高数课") -> str:
        start = self.clock.now() + start_in
        return self.events.create("local", title, "教三 204", "Asia/Shanghai", start,
                                  start + timedelta(minutes=minutes)).event_id

    def advance(self, delta: timedelta) -> None:
        self.clock.value += delta

    def state(self) -> dict[str, Any]:
        response = self.client.get("/api/v1/state")
        assert response.status_code == 200, response.text
        body: dict[str, Any] = response.json()
        return body


@pytest.fixture
def harness(tmp_path: Path) -> Iterator[Harness]:
    yield Harness(tmp_path / "kairos.sqlite3")


@pytest.fixture
def no_model(tmp_path: Path) -> Iterator[Harness]:
    yield Harness(tmp_path / "kairos.sqlite3", with_model=False)
