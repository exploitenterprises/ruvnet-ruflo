"""End-to-end signal + backtest tests built on one hand-crafted scenario.

The scenario encodes, in a single synthetic OHLCV+attention+phase series, a
squeeze-then-expansion in volatility, a capitulation flush followed by a
reversal candle, a crowd-attention spike with no price follow-through, and
an MFI upturn out of oversold — i.e. every sub-condition CADS requires,
timed to align only on bar 46. This isn't cherry-picked to force a win; it
verifies the AND-gate actually gates (bar 43 has an attention divergence
too, but nothing else lines up there, so entry_long must stay False) and
that the backtester's stop/target/timeout branches each fire when the
price action after entry calls for them.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from strategies.cycle_attention_divergence.backtest import run_backtest
from strategies.cycle_attention_divergence.strategy import StrategyConfig, generate_signals

CANDIDATE = 46
CONFIG = StrategyConfig(atr_rank_window=30)


def _base_frame(n: int = 70, seed: int = 3) -> pd.DataFrame:
    idx = pd.bdate_range("2024-01-01", periods=n)
    rng = np.random.default_rng(seed)

    rangev = np.zeros(n)
    drift = np.zeros(n)
    for i in range(n):
        if i < 30:
            rangev[i] = 1.5 + rng.uniform(-0.15, 0.15)
            drift[i] = rng.uniform(-0.05, 0.05)
        elif i < 45:
            rangev[i] = 0.25 + rng.uniform(-0.05, 0.05)  # compressed squeeze
            drift[i] = -0.18 + rng.uniform(-0.03, 0.03)  # steady decline into oversold
        elif i == 45:
            rangev[i] = 6.0
            drift[i] = -1.2  # capitulation flush candle (volatility expansion begins)
        elif i == 46:
            rangev[i] = 6.0
            drift[i] = 0.3  # reversal day: this is the intended entry_long bar
        elif i == 47:
            rangev[i] = 3.0
            drift[i] = 0.5
        else:
            rangev[i] = 1.0 + rng.uniform(-0.1, 0.1)
            drift[i] = rng.uniform(-0.05, 0.1)

    close = np.zeros(n)
    close[0] = 100.0
    for i in range(1, n):
        close[i] = close[i - 1] + drift[i]

    high = close + rangev / 2
    low = close - rangev / 2
    high[45] = close[45] + rangev[45] * 0.1
    low[45] = close[45] - rangev[45] * 0.9
    close[46] = high[45] + 0.5  # forces the trigger-candle condition: close > prior high
    high[46] = close[46] + 0.3
    low[46] = close[46] - rangev[46]

    openp = np.roll(close, 1)
    openp[0] = close[0]
    volume = np.full(n, 1_000_000.0)

    df = pd.DataFrame({"open": openp, "high": high, "low": low, "close": close, "volume": volume}, index=idx)

    attention = 50 + rng.normal(0, 3, n)
    attention[CANDIDATE] = 96.0  # crowd-attention spike with flat/down price -> divergence
    df["attention"] = attention

    # 200 deg is outside both the accumulation and distribution zones, so once the
    # candidate bar passes, phase_zone no longer forces a same-bar signal exit and
    # the stop/target/timeout branches in the backtester can be tested in isolation.
    phase = np.full(n, 200.0)
    phase[CANDIDATE] = 10.0
    df["ht_dcphase"] = phase
    return df


def test_entry_fires_only_on_the_bar_where_every_condition_aligns():
    df = _base_frame()
    sig = generate_signals(df, CONFIG)

    fired = sig.index[sig["entry_long"]]
    assert list(fired) == [df.index[CANDIDATE]]

    row = sig.iloc[CANDIDATE]
    assert row["regime_transition"]
    assert row["phase_zone"] == "accumulation"
    assert row["divergence_long"]
    assert row["mfi"] > sig.iloc[CANDIDATE - 1]["mfi"]
    assert sig.iloc[CANDIDATE - 1]["mfi"] < CONFIG.mfi_oversold

    # bar 43 has a genuine attention divergence too, but the regime/phase/mfi
    # conditions don't line up there, so the AND-gate must reject it.
    assert sig.iloc[43]["divergence_long"]
    assert not sig.iloc[43]["entry_long"]


def test_backtest_fills_at_next_bar_open_and_times_out_when_nothing_else_fires():
    df = _base_frame()
    result = run_backtest(df, CONFIG)

    assert len(result.trades) == 1
    trade = result.trades[0]
    assert trade.entry_price == pytest.approx(df["open"].iloc[CANDIDATE + 1])
    assert trade.entry_date == df.index[CANDIDATE + 1]
    assert trade.exit_reason == "timeout"
    assert trade.bars_held == CONFIG.max_holding_bars


def test_backtest_exits_at_target_when_price_reaches_it():
    df = _base_frame()
    sig = generate_signals(df, CONFIG)
    entry_atr = sig.iloc[CANDIDATE]["atr"]
    entry_price = df["open"].iloc[CANDIDATE + 1]
    target = entry_price + CONFIG.target_atr_mult * entry_atr

    hit_bar = CANDIDATE + 2
    df.loc[df.index[hit_bar], ["high", "close", "low"]] = [target + 1.0, target + 0.5, target - 0.5]

    result = run_backtest(df, CONFIG)
    trade = result.trades[0]
    assert trade.exit_reason == "target"
    assert trade.exit_price == pytest.approx(target)
    assert trade.bars_held == 1


def test_backtest_exits_at_stop_when_price_reaches_it():
    df = _base_frame()
    sig = generate_signals(df, CONFIG)
    entry_atr = sig.iloc[CANDIDATE]["atr"]
    entry_price = df["open"].iloc[CANDIDATE + 1]
    stop = entry_price - CONFIG.stop_atr_mult * entry_atr

    hit_bar = CANDIDATE + 2
    df.loc[df.index[hit_bar], ["low", "close", "high"]] = [stop - 1.0, stop - 0.5, stop + 0.5]

    result = run_backtest(df, CONFIG)
    trade = result.trades[0]
    assert trade.exit_reason == "stop"
    assert trade.exit_price == pytest.approx(stop)
    assert trade.bars_held == 1


def test_summary_reports_zero_trades_on_flat_uneventful_data():
    idx = pd.bdate_range("2024-01-01", periods=40)
    flat = pd.Series(100.0, index=idx)
    df = pd.DataFrame(
        {
            "open": flat,
            "high": flat + 0.1,
            "low": flat - 0.1,
            "close": flat,
            "volume": 1_000.0,
            "ht_dcphase": 200.0,
            "attention": 50.0,
        },
        index=idx,
    )
    result = run_backtest(df, CONFIG)
    assert result.summary() == {"num_trades": 0}
