import numpy as np
import pandas as pd
import pytest

from strategies.cycle_attention_divergence.indicators import (
    atr,
    money_flow_index,
    normalize_phase_degrees,
    rolling_percentile_rank,
    zscore,
)


def test_atr_matches_hand_computed_true_range():
    high = pd.Series([10.0, 12.0, 11.0])
    low = pd.Series([8.0, 9.0, 8.5])
    close = pd.Series([9.0, 11.0, 9.5])
    # bar0 TR = high-low = 2.0 (no prior close)
    # bar1 TR = max(12-9, |12-9|, |9-9|) = 3.0
    # bar2 TR = max(11-8.5, |11-11|, |8.5-11|) = 2.5
    result = atr(high, low, close, period=2)
    assert result.iloc[0:1].isna().all()  # min_periods warm-up (needs 2 bars for period=2)
    # ATR is an EWM of true range, so it must sit within the range of TRs seen so far
    assert 2.0 <= result.iloc[1] <= 3.0
    assert 2.0 <= result.iloc[2] <= 3.0


def test_money_flow_index_is_bounded_and_extremes_are_correct():
    idx = pd.date_range("2024-01-01", periods=20)
    up = pd.Series(np.arange(100, 120), index=idx, dtype=float)
    high = up + 1
    low = up - 1
    volume = pd.Series(1_000.0, index=idx)

    mfi_up = money_flow_index(high, low, up, volume, period=14)
    assert (mfi_up.dropna() == 100.0).all()

    down = pd.Series(np.arange(120, 100, -1), index=idx, dtype=float)
    mfi_down = money_flow_index(down + 1, down - 1, down, volume, period=14)
    assert (mfi_down.dropna() == 0.0).all()

    assert mfi_up.dropna().between(0, 100).all()
    assert mfi_down.dropna().between(0, 100).all()


def test_rolling_percentile_rank_ranks_a_monotonic_series_at_the_top():
    series = pd.Series(np.arange(1, 51, dtype=float))
    ranks = rolling_percentile_rank(series, window=20)
    assert ranks.iloc[-1] == pytest.approx(100.0)


def test_normalize_phase_degrees_wraps_negative_values():
    phase = pd.Series([-44.6963, 314.8632, 400.0, 0.0])
    normalized = normalize_phase_degrees(phase)
    assert normalized.iloc[0] == pytest.approx(315.3037, rel=1e-4)
    assert normalized.iloc[1] == pytest.approx(314.8632, rel=1e-4)
    assert normalized.iloc[2] == pytest.approx(40.0, rel=1e-4)
    assert (normalized >= 0).all() and (normalized < 360).all()


def test_zscore_flags_an_outlier_spike():
    baseline = pd.Series([50.0] * 25 + list(50 + np.tile([1, -1], 5)))
    baseline_with_spike = pd.concat([baseline, pd.Series([95.0])], ignore_index=True)
    z = zscore(baseline_with_spike, window=20)
    assert z.iloc[-1] > 3.0
