"""Indicator primitives for the Cycle-Attention Divergence Swing (CADS) strategy.

Only ATR, MFI, percentile-rank and z-score are implemented here — they are
simple enough to reimplement correctly from raw OHLCV. The Hilbert Transform
Dominant Cycle Phase (HT_DCPHASE) is deliberately NOT reimplemented: it's a
recursive Ehlers homodyne-discriminator filter, and a from-scratch port is
too easy to get subtly wrong. Source it from a vetted implementation (e.g.
Alpha Vantage's HT_DCPHASE endpoint or TA-Lib) and feed it in as the
`ht_dcphase` column expected by strategy.py.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    prev_close = close.shift(1)
    ranges = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    )
    return ranges.max(axis=1)


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    tr = true_range(high, low, close)
    return tr.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


def rolling_percentile_rank(series: pd.Series, window: int = 100) -> pd.Series:
    """Percentile rank (0-100) of the last value within its trailing window."""

    def _rank(x: np.ndarray) -> float:
        if len(x) < 2:
            return np.nan
        return float((x[:-1] < x[-1]).mean() * 100.0)

    return series.rolling(window, min_periods=max(10, window // 2)).apply(_rank, raw=True)


def money_flow_index(
    high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series, period: int = 14
) -> pd.Series:
    typical_price = (high + low + close) / 3
    raw_money_flow = typical_price * volume
    direction = typical_price.diff()

    positive_flow = raw_money_flow.where(direction > 0, 0.0)
    negative_flow = raw_money_flow.where(direction < 0, 0.0)

    positive_sum = positive_flow.rolling(period).sum()
    negative_sum = negative_flow.rolling(period).sum()

    with np.errstate(divide="ignore", invalid="ignore"):
        money_ratio = positive_sum / negative_sum
    mfi = 100 - (100 / (1 + money_ratio))
    mfi = mfi.mask(negative_sum == 0, 100.0)
    mfi = mfi.mask((positive_sum == 0) & (negative_sum == 0), 50.0)
    return mfi


def normalize_phase_degrees(phase: pd.Series) -> pd.Series:
    """Map any HT_DCPHASE convention (incl. negative degrees) onto [0, 360)."""
    return phase % 360


def zscore(series: pd.Series, window: int = 20) -> pd.Series:
    min_periods = max(5, window // 2)
    mean = series.rolling(window, min_periods=min_periods).mean()
    std = series.rolling(window, min_periods=min_periods).std(ddof=0)
    return (series - mean) / std.replace(0, np.nan)


def rate_of_change(series: pd.Series, window: int = 5) -> pd.Series:
    return series.pct_change(window)
