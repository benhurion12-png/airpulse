from app.air_quality import combined_quality, parameter_quality


def test_quality_is_bounded():
    assert parameter_quality("PM2.5", 0) == 100
    assert parameter_quality("PM2.5", 1000) == 0


def test_single_sensor_uses_only_its_parameter():
    assert combined_quality([("CO2", 800)]) == parameter_quality("CO2", 800)


def test_multiple_sensors_are_averaged():
    expected = round((parameter_quality("CO2", 800) + parameter_quality("PM2.5", 75)) / 2, 1)
    assert combined_quality([("CO2", 800), ("PM2.5", 75)]) == expected

