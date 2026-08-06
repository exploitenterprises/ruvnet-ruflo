"""Cycle-Attention Divergence Swing Strategy (CADS).

See README.md in this directory for the full thesis and rules. In short,
a long swing entry requires all four of:

1. Volatility regime just flipped from compressed to expanding (an
   ATR-percentile squeeze release) — trades the initiation of a swing move
   rather than a move already underway.
2. Price sits in the "accumulation" zone of its dominant Hilbert-transform
   price cycle (HT_DCPHASE) — cycle-phase used as an entry-timing gate,
   not as a trend filter.
3. Crowd attention (message-volume chatter) diverges from price: either a
   chatter spike with no price follow-through, or a chatter collapse after
   a decline (apathy/capitulation) — decoupled from sentiment polarity.
4. Money Flow Index turning up out of oversold, as the trigger confirmation.

This module is pure/stateless: it only computes indicator and signal
columns on a DataFrame. Path-dependent position management (stops,
trailing, holding period, sizing) lives in backtest.py.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .indicators import (
    atr,
    money_flow_index,
    normalize_phase_degrees,
    rate_of_change,
    rolling_percentile_rank,
    zscore,
)

REQUIRED_COLUMNS = ("open", "high", "low", "close", "volume", "ht_dcphase", "attention")


@dataclass(frozen=True)
class StrategyConfig:
    atr_period: int = 14
    atr_rank_window: int = 100
    vol_compressed_pct: float = 25.0
    vol_expanding_pct: float = 40.0
    regime_lookback: int = 2

    accumulation_zone: tuple[float, float] = (270.0, 30.0)  # wraps through 360/0
    distribution_zone: tuple[float, float] = (90.0, 180.0)

    attention_window: int = 20
    attention_spike_z: float = 1.5
    attention_collapse_z: float = -1.0
    attention_euphoria_z: float = 2.0
    price_roc_window: int = 5

    mfi_period: int = 14
    mfi_oversold: float = 30.0
    mfi_overbought: float = 70.0

    stop_atr_mult: float = 1.5
    target_atr_mult: float = 2.5
    trail_trigger_atr_mult: float = 1.0
    max_holding_bars: int = 10
    allow_short: bool = False


def _phase_in_zone(phase: pd.Series, zone: tuple[float, float]) -> pd.Series:
    lo, hi = zone
    if lo <= hi:
        return (phase >= lo) & (phase < hi)
    return (phase >= lo) | (phase < hi)


def generate_signals(df: pd.DataFrame, config: StrategyConfig | None = None) -> pd.DataFrame:
    """Return a copy of df with indicator and signal columns appended.

    Expects columns: open, high, low, close, volume, ht_dcphase, attention
    (attention is a 0-100 crowd chatter/message-volume index, e.g. from
    Stocktwits message-volume history). Rows are assumed sorted ascending
    by date with no gaps that would confuse rolling windows.
    """
    cfg = config or StrategyConfig()
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"missing required columns: {missing}")

    out = df.copy()

    out["atr"] = atr(out["high"], out["low"], out["close"], cfg.atr_period)
    out["atr_rank"] = rolling_percentile_rank(out["atr"], cfg.atr_rank_window)
    out["mfi"] = money_flow_index(out["high"], out["low"], out["close"], out["volume"], cfg.mfi_period)

    compressed = out["atr_rank"] < cfg.vol_compressed_pct
    expanding = out["atr_rank"] >= cfg.vol_expanding_pct
    was_compressed_recently = compressed.shift(1).rolling(cfg.regime_lookback, min_periods=1).max().astype(bool)
    out["regime_transition"] = expanding & was_compressed_recently

    phase = normalize_phase_degrees(out["ht_dcphase"])
    out["phase_zone"] = np.select(
        [_phase_in_zone(phase, cfg.accumulation_zone), _phase_in_zone(phase, cfg.distribution_zone)],
        ["accumulation", "distribution"],
        default="neutral",
    )

    out["attention_z"] = zscore(out["attention"], cfg.attention_window)
    out["price_roc"] = rate_of_change(out["close"], cfg.price_roc_window)

    attention_spike_no_follow = (out["attention_z"] > cfg.attention_spike_z) & (out["price_roc"] <= 0)
    attention_collapse_after_selloff = (out["attention_z"] < cfg.attention_collapse_z) & (out["price_roc"] < 0)
    out["divergence_long"] = attention_spike_no_follow | attention_collapse_after_selloff
    out["euphoria_exit"] = (out["attention_z"] > cfg.attention_euphoria_z) & (out["price_roc"] > 0)

    mfi_prev = out["mfi"].shift(1)
    mfi_turning_up = (mfi_prev < cfg.mfi_oversold) & (out["mfi"] > mfi_prev)
    trigger_candle = out["close"] > out["high"].shift(1)

    out["entry_long"] = (
        out["regime_transition"]
        & (out["phase_zone"] == "accumulation")
        & out["divergence_long"]
        & mfi_turning_up
        & trigger_candle
    ).fillna(False)

    out["exit_signal_long"] = (out["phase_zone"] == "distribution") | out["euphoria_exit"].fillna(False)

    if cfg.allow_short:
        attention_spike_no_selloff = (out["attention_z"] > cfg.attention_spike_z) & (out["price_roc"] >= 0)
        attention_collapse_after_rally = (out["attention_z"] < cfg.attention_collapse_z) & (out["price_roc"] > 0)
        out["divergence_short"] = attention_spike_no_selloff | attention_collapse_after_rally
        mfi_turning_down = (mfi_prev > cfg.mfi_overbought) & (out["mfi"] < mfi_prev)
        trigger_candle_short = out["close"] < out["low"].shift(1)
        out["entry_short"] = (
            out["regime_transition"]
            & (out["phase_zone"] == "distribution")
            & out["divergence_short"]
            & mfi_turning_down
            & trigger_candle_short
        ).fillna(False)
        out["exit_signal_short"] = (out["phase_zone"] == "accumulation") | out["euphoria_exit"].fillna(False)

    return out
