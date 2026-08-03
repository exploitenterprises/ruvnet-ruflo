#!/usr/bin/env python3
"""Multi-timeframe relative-volume analysis for the crypto swing-trade scanner.

Strategy: we care about RELATIVE volume (current candle vs. its own recent
average), not raw dollar volume or % price gain — the goal is to catch a
volume spike *before* the big price move, across several candle sizes at
once. A spike that shows up on a low timeframe (1m/5m) first is weighted
higher, since that's the earliest possible signal.
"""
import re
from statistics import mean

TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h"]

# Lower timeframe = earlier signal = weighted higher, per the strategy.
TIMEFRAME_WEIGHTS = {
    "1m": 6,
    "5m": 5,
    "15m": 4,
    "30m": 3,
    "1h": 2,
    "4h": 1,
}

_NON_SPOT_PREFIXES = (
    "AAPL", "NVDA", "GOOGL", "AMZN", "TSLA", "MSFT", "META", "NFLX", "IBM",
    "INTC", "AMD", "QCOM", "CSCO", "ORCL", "COIN", "HOOD", "PLTR", "DELL",
    "CRWV", "BABA", "COST", "AVGO", "MRVL", "SNDK", "KIOXIA", "SAMSUNG",
    "HYUNDAI", "SKHYNIX", "LLY", "BRKB", "TEVA", "GME", "MSTR", "SPY", "QQQ",
    "IWM", "TQQQ", "SQQQ", "SOXL", "SOXS", "UVXY", "TZA", "XAU", "XAG",
    "XPT", "XPD", "NATGAS",
)


def is_spot(name):
    if "PERP" in name:
        return False
    if re.search(r"\d{6}$", name):  # dated futures e.g. BTCUSD260828
        return False
    if name.startswith(_NON_SPOT_PREFIXES):
        return False
    return True


def spot_usd_pairs(instrument_names):
    return [
        n for n in instrument_names
        if is_spot(n) and (n.endswith("USD") or n.endswith("USDT"))
    ]


def relative_volume(candle_volumes, lookback=20):
    """candle_volumes: list of volumes, oldest first, LAST element is the current/most-recent candle.
    Returns current volume / mean(prior `lookback` candles), or None if not enough history."""
    if len(candle_volumes) < lookback + 1:
        return None
    current = candle_volumes[-1]
    baseline = candle_volumes[-(lookback + 1):-1]
    avg = mean(baseline)
    if avg <= 0:
        return None
    return current / avg


def consensus_score(rel_vol_by_tf):
    """rel_vol_by_tf: {timeframe: relative_volume_ratio or None}.
    Weighted score favoring spikes on lower timeframes. Also returns how many
    timeframes are meaningfully elevated (>=2x), since a single-timeframe
    spike is much weaker evidence than several agreeing."""
    score = 0.0
    elevated_tfs = []
    for tf, ratio in rel_vol_by_tf.items():
        if ratio is None:
            continue
        w = TIMEFRAME_WEIGHTS.get(tf, 1)
        # Above 1.0 contributes positively, scaled by how far above baseline.
        score += w * max(ratio - 1.0, 0)
        if ratio >= 2.0:
            elevated_tfs.append(tf)
    return score, elevated_tfs


def qualifies(rel_vol_by_tf, min_elevated_timeframes=2, min_ratio=3.0):
    """A real signal needs at least `min_elevated_timeframes` timeframes showing
    at least `min_ratio`x relative volume — agreement across timeframes, not a
    one-off blip on a single candle size."""
    strong = [tf for tf, r in rel_vol_by_tf.items() if r is not None and r >= min_ratio]
    return len(strong) >= min_elevated_timeframes, strong


def trade_plan(entry_price, stop_loss_pct=0.07, take_profit_pct=0.22):
    """Defaults: 7% stop (mid of the requested 5-10% range), 22% target
    (~3:1 reward:risk) since winners should be allowed to run further."""
    return {
        "entry_price": entry_price,
        "stop_loss_price": round(entry_price * (1 - stop_loss_pct), 10),
        "take_profit_price": round(entry_price * (1 + take_profit_pct), 10),
        "stop_loss_pct": stop_loss_pct,
        "take_profit_pct": take_profit_pct,
    }
