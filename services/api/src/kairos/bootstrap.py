"""Composition root: the only place that wires adapters to application services."""

from fastapi import FastAPI

from kairos.adapters.ai.mimo import MimoModel
from kairos.adapters.clock import SystemClock
from kairos.adapters.sqlite.database import migrate
from kairos.adapters.sqlite.unit_of_work import SqliteUnitOfWorkFactory
from kairos.adapters.weather.open_meteo import OpenMeteoProvider
from kairos.api import errors
from kairos.api.deps import Services
from kairos.api.routes import assistant, environment, health, schedule
from kairos.application.assistant.conversation import AssistantService
from kairos.application.assistant.drafts import DraftService
from kairos.application.assistant.model import AssistantModel
from kairos.application.ports import Clock
from kairos.application.schedule import ScheduleService
from kairos.application.weather import WeatherProvider, WeatherService
from kairos.settings import Settings


def create_app(settings: Settings | None = None, *, clock: Clock | None = None,
               weather: WeatherProvider | None = None, model: AssistantModel | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    clock = clock or SystemClock()
    migrate(settings.database_path)
    uow = SqliteUnitOfWorkFactory(settings.database_path)
    if model is None and settings.assistant_configured:
        model = MimoModel(settings.mimo_api_key, settings.mimo_base_url, settings.mimo_model)
    weather_service = WeatherService(weather or OpenMeteoProvider(), clock)
    app = FastAPI(title="Kairos API", version="0.3.0")
    app.state.services = Services(
        owner_id=settings.owner_id, schedule=ScheduleService(uow, clock), weather=weather_service,
        # Without a model the assistant answers 503 and everything else keeps working.
        assistant=AssistantService(uow, clock, model, weather_service), drafts=DraftService(uow, clock),
        assistant_available=model is not None)
    errors.install(app)
    for module in (health, schedule, environment, assistant):
        app.include_router(module.router, prefix="/api/v1")
    return app


def serve() -> None:
    import uvicorn

    settings = Settings.from_env()
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)
