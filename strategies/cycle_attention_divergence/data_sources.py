"""Adapters that assemble the DataFrame generate_signals()/run_backtest() expect
from raw API responses. No network calls happen here — callers already fetched
the JSON (e.g. via an MCP tool or requests) and just need it reshaped and
aligned onto one daily index.

Expected inputs, matching what these two APIs actually return:
  - Alpha Vantage TIME_SERIES_DAILY_ADJUSTED -> {"Time Series (Daily)": {date: {...}}}
  - Alpha Vantage HT_DCPHASE                 -> {"Technical Analysis: HT_DCPHASE": {date: {"HT_DCPHASE": "..."}}}
  - Stocktwits get_message_volume_history    -> {"series": [{"time": ..., "value": ...}, ...]}
"""
from __future__ import annotations

import pandas as pd


def ohlcv_from_alpha_vantage_daily(payload: dict) -> pd.DataFrame:
    series = payload["Time Series (Daily)"]
    rows = {
        pd.Timestamp(date): {
            "open": float(v["1. open"]),
            "high": float(v["2. high"]),
            "low": float(v["3. low"]),
            "close": float(v["4. close"]),
            "volume": float(v["6. volume"]) if "6. volume" in v else float(v["5. volume"]),
        }
        for date, v in series.items()
    }
    return pd.DataFrame.from_dict(rows, orient="index").sort_index()


def ht_dcphase_from_alpha_vantage(payload: dict) -> pd.Series:
    series = payload["Technical Analysis: HT_DCPHASE"]
    data = {pd.Timestamp(date): float(v["HT_DCPHASE"]) for date, v in series.items()}
    return pd.Series(data, name="ht_dcphase").sort_index()


def attention_from_stocktwits(payload: dict) -> pd.Series:
    data = {pd.Timestamp(point["time"]).normalize(): float(point["value"]) for point in payload["series"]}
    return pd.Series(data, name="attention").sort_index()


def build_strategy_frame(
    ohlcv_payload: dict, ht_dcphase_payload: dict, attention_payload: dict
) -> pd.DataFrame:
    """Join the three raw API payloads into the single frame the strategy needs.

    Attention data (daily chatter index) is typically sparser than trading-day
    OHLCV (e.g. missing on some sessions); it's forward-filled onto the price
    index so the most recent known crowd-attention read carries forward.
    """
    ohlcv = ohlcv_from_alpha_vantage_daily(ohlcv_payload)
    phase = ht_dcphase_from_alpha_vantage(ht_dcphase_payload)
    attention = attention_from_stocktwits(attention_payload)

    df = ohlcv.copy()
    df["ht_dcphase"] = phase.reindex(df.index)
    df["attention"] = attention.reindex(df.index).ffill()
    return df.dropna(subset=["ht_dcphase", "attention"])
