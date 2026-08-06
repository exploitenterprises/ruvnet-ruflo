# Cycle-Attention Divergence Swing Strategy (CADS)

A swing-trading strategy (3–10 trading day holding period) built from a
combination of signal families that, as far as we could establish, has no
existing name or public writeup: **dominant-cycle phase used as an entry
timing gate**, **crowd-attention (chatter volume) divergence from price**,
and **volatility-regime squeeze/release gating** — stacked together and
confirmed by a Money Flow Index turn. Each ingredient individually is
well-known; the combination and the specific role each one plays is not.

This is a research/educational reference implementation, not investment
advice, and it has not been validated against real historical data with
statistical significance — see [Status & limitations](#status--limitations).

## Why this isn't just another named strategy

- It doesn't use Hilbert Transform Dominant Cycle Phase (`HT_DCPHASE`) as a
  trend-regime filter (the common use, e.g. "only trust momentum indicators
  when the market is in trend mode vs. cycle mode"). Here it's the opposite:
  phase directly gates *when* to look for an entry, treating the dominant
  cycle's trough/crest as swing turning points to time around.
- It doesn't use social/crowd sentiment as a directional signal (buy when
  bullish chatter rises — the common "sentiment momentum" approach). It uses
  **message *volume*, decoupled from polarity**, and looks for
  *divergence* from price — either a chatter spike that price hasn't
  confirmed yet, or a chatter collapse (apathy) after a decline — which is
  a contrarian, not trend-following, read.
- It doesn't trade volatility breakouts on their own (e.g. Bollinger
  Band squeeze breakout systems trade the breakout candle itself). Here the
  squeeze→expansion transition is a *necessary gate*, not the trigger — it
  only opens a short window in which the other two conditions are allowed
  to fire, on the premise that swing-sized moves start at the initiation of
  a volatility regime shift, not once already underway.

## Signal stack

| Layer | Indicator | Role |
|---|---|---|
| Volatility regime | ATR(14) percentile rank over a trailing window | Gate: only allow entries within `regime_lookback` bars of a compressed→expanding transition |
| Cycle timing | `HT_DCPHASE` (Hilbert Transform Dominant Cycle Phase), normalized to 0–360° | Gate: price must be in the "accumulation" phase zone `[270°, 360°) ∪ [0°, 30°)` |
| Crowd attention | Message-volume/chatter index (0–100, e.g. Stocktwits), z-scored over a trailing window, compared against price rate-of-change | Edge: a divergence between chatter and price, not sentiment direction |
| Money flow | MFI(14) | Trigger: must be turning up out of oversold (`< 30`) |
| Confirmation | Close vs. prior bar's high | Trigger candle |

### Long entry — all of the following on the same bar

1. `regime_transition`: ATR percentile rank just crossed from `< 25th`
   percentile ("compressed") to `>= 40th` percentile ("expanding") within
   the last `regime_lookback` (default 2) bars.
2. `phase_zone == "accumulation"`: normalized `HT_DCPHASE` in
   `[270°, 360°) ∪ [0°, 30°)`.
3. `divergence_long`: crowd-attention z-score `> 1.5` while price's 5-bar
   rate of change is `<= 0` (chatter spike, no price follow-through yet) —
   **or** attention z-score `< -1.0` while price's 5-bar ROC is `< 0`
   (chatter has collapsed after a decline — apathy/capitulation).
4. MFI(14) crossing up: previous bar's MFI `< 30` and current MFI `>` previous.
5. Trigger candle: close `>` prior bar's high.

Entries fill at the **next bar's open** (no lookahead).

### Exit — first of

- `HT_DCPHASE` phase zone reaches "distribution" `[90°, 180°)` (soft, signal-based exit).
- Attention "euphoria" mirror: z-score `> 2.0` while price ROC `> 0` — crowd
  piling in *with* price now, the mirror image of the entry condition, read
  as a distribution warning.
- Price hits the 2.5×ATR profit target.
- Price hits the 1.5×ATR initial stop (ratcheted to breakeven once the
  trade has moved `1.0×ATR` in its favor).
- `max_holding_bars` (default 10) elapses — timeout.

A mirrored short setup (distribution-zone phase, downside attention
divergence, MFI turning down from overbought) is implemented and available
via `StrategyConfig(allow_short=True)`, but is not the primary focus.

## Layout

- `indicators.py` — ATR, percentile rank, MFI, z-score, phase normalization.
  All reimplemented from raw OHLCV; deliberately simple, so they're
  trustworthy. `HT_DCPHASE` itself is **not** reimplemented here (see the
  module docstring) — source it from Alpha Vantage's `HT_DCPHASE` endpoint
  or TA-Lib and feed it in.
- `strategy.py` — `generate_signals(df, config)`: pure/stateless, computes
  every indicator and signal column above.
- `backtest.py` — `run_backtest(df, config)`: a simple single-position,
  bar-by-bar simulator that handles the path-dependent parts (stop,
  trailing, target, timeout) a vectorized backtest can't represent.
- `data_sources.py` — adapters that reshape raw Alpha Vantage /
  Stocktwits API JSON into the DataFrame the strategy expects. No network
  calls happen in this module; wire your own HTTP/MCP client to whatever
  fetches those payloads.
- `tests/` — indicator unit tests plus one hand-crafted end-to-end scenario
  that exercises the full entry AND-gate and all three backtest exit
  branches (target / stop / timeout).

## Usage

```python
import pandas as pd
from strategies.cycle_attention_divergence import StrategyConfig, generate_signals, run_backtest

# df needs: open, high, low, close, volume, ht_dcphase, attention
df: pd.DataFrame = ...

config = StrategyConfig(max_holding_bars=10, target_atr_mult=2.5)
signals = generate_signals(df, config)
result = run_backtest(df, config)

print(result.summary())
for trade in result.closed_trades:
    print(trade)
```

To assemble `df` from raw API responses:

```python
from strategies.cycle_attention_divergence.data_sources import build_strategy_frame

df = build_strategy_frame(
    ohlcv_payload=alpha_vantage_time_series_daily_adjusted_json,
    ht_dcphase_payload=alpha_vantage_ht_dcphase_json,
    attention_payload=stocktwits_message_volume_history_json,
)
```

## Status & limitations

- **Not backtested against real market data.** Alpha Vantage's free-tier
  rate limit was hit while building this, so the strategy is validated only
  against a hand-crafted synthetic scenario (see `tests/`) that proves the
  signal logic and exit-management mechanics behave as specified — it does
  not demonstrate historical profitability on any real instrument.
- **Real, current crowd-attention data was used only as design input, not
  as a backtest.** While building this, live Stocktwits data for NVDA
  showed exactly the kind of pattern the strategy is designed around: message
  volume and sentiment both spiked to "Extremely High" (~80-88) in
  late May 2026, then collapsed to "Slightly/Extremely Low" chatter (~28-30)
  with "Extremely Bearish" sentiment (~23-25) by mid-June 2026 — a real
  attention euphoria-then-apathy cycle. That's the shape `divergence_long`
  and `euphoria_exit` are built to catch, but it was not run through
  `generate_signals`/`run_backtest` end-to-end against NVDA's actual price
  series in this exercise, so treat it as motivation, not a validated trade.
- Attention data (`get_message_volume_history` / `get_sentiment_history`) is
  Stocktwits-specific; any comparable chatter-volume metric works as a
  drop-in as long as it's a 0–100 index sampled at least daily.
- `HT_DCPHASE`'s zone boundaries (`accumulation`/`distribution`) and every
  threshold in `StrategyConfig` are starting points based on the strategy's
  design logic, not optimized/fit to any dataset. Anyone using this for real
  trading should walk-forward test and tune thresholds on their own
  instrument universe first, and understand that increasing data-mining
  bias risk from over-tuning applies here as with any rule-based strategy.
- This is not financial advice. Past patterns in indicators, including the
  real Stocktwits data referenced above, are not predictive of future
  returns.
