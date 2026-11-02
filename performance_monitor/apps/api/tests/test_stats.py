import pytest

from app.stats import WindowError, delta_pct, estimate_percentile, make_window


def test_percentile_interpolates_histogram():
    # 100 calls, 90 at or under 100ms, all 100 at or under 200ms.
    cumulative = [0, 90, 100, 100, 100, 100, 100, 100, 100]
    assert estimate_percentile(0, cumulative, 0.95) is None
    p50 = estimate_percentile(100, cumulative, 0.50)
    assert p50 is not None and 50 < p50 < 100
    p95 = estimate_percentile(100, cumulative, 0.95)
    assert p95 is not None and 100 < p95 < 200


def test_delta_pct_handles_zero_baseline():
    assert delta_pct(10, 0) is None
    assert delta_pct(110, 100) == 10


def test_range_validation():
    window = make_window("15m", "prod")
    assert window.resolution == "1m"
    assert window.env == "prod"
    with pytest.raises(WindowError):
        make_window("2h")
