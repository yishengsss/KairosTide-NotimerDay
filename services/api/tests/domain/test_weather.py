import pytest

from kairos.domain.weather import condition_for, normalize


def test_clear_sky_has_no_precipitation() -> None:
    weather = normalize(0, None, None, None, None)
    assert (weather.condition, weather.rain, weather.snow, weather.fog, weather.thunder) == ("clear", 0, 0, 0, False)


def test_measured_rain_refines_code() -> None:
    light = normalize(63, 90, 0.0, 9000, 3)
    heavy = normalize(63, 90, 6.0, 9000, 3)
    assert 0 < light.rain < heavy.rain <= 1
    assert light.snow == 0


def test_thunder_only_for_thunderstorm_codes() -> None:
    assert normalize(95, 100, 2, None, 10).thunder
    assert not normalize(82, 100, 8, None, 10).thunder


def test_fog_from_code_or_low_visibility() -> None:
    assert normalize(45, None, None, None, None).fog == 0.9
    assert normalize(3, 100, None, 400, None).fog == 1.0
    assert normalize(3, 100, None, 5000, None).fog == 0


def test_wind_is_clamped() -> None:
    assert normalize(1, 10, None, None, 30).wind == 1


def test_unknown_code_is_rejected() -> None:
    with pytest.raises(ValueError):
        condition_for(42)
