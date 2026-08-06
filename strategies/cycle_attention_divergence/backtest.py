"""Single-position, path-dependent backtester for CADS signals.

Deliberately simple and long-only-by-default: swing strategies live or die
on exit management (stops, trailing, timeouts), which a vectorized
all-at-once backtest can't represent faithfully, so this walks the bars in
a loop. Fills use the next bar's open (no lookahead), and only one position
is held at a time.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from .strategy import StrategyConfig, generate_signals


@dataclass
class Trade:
    entry_date: pd.Timestamp
    entry_price: float
    entry_atr: float
    initial_stop: float
    stop: float
    target: float
    exit_date: pd.Timestamp | None = None
    exit_price: float | None = None
    exit_reason: str | None = None
    bars_held: int = 0

    @property
    def r_multiple(self) -> float | None:
        if self.exit_price is None:
            return None
        risk = self.entry_price - self.initial_stop
        if risk <= 0:
            return None
        return (self.exit_price - self.entry_price) / risk

    @property
    def pnl_pct(self) -> float | None:
        if self.exit_price is None:
            return None
        return (self.exit_price - self.entry_price) / self.entry_price


@dataclass
class BacktestResult:
    trades: list[Trade] = field(default_factory=list)

    @property
    def closed_trades(self) -> list[Trade]:
        return [t for t in self.trades if t.exit_price is not None]

    def summary(self) -> dict:
        closed = self.closed_trades
        if not closed:
            return {"num_trades": 0}

        r_values = [t.r_multiple for t in closed if t.r_multiple is not None]
        wins = [r for r in r_values if r > 0]
        losses = [r for r in r_values if r <= 0]

        equity = 1.0
        peak = 1.0
        max_drawdown = 0.0
        for t in closed:
            equity *= 1 + (t.pnl_pct or 0.0)
            peak = max(peak, equity)
            max_drawdown = max(max_drawdown, (peak - equity) / peak)

        gross_win = sum(wins)
        gross_loss = abs(sum(losses))

        return {
            "num_trades": len(closed),
            "win_rate": len(wins) / len(closed),
            "avg_r": sum(r_values) / len(r_values) if r_values else 0.0,
            "expectancy_r": sum(r_values) / len(closed),
            "profit_factor": (gross_win / gross_loss) if gross_loss > 0 else float("inf"),
            "max_drawdown_pct": max_drawdown * 100,
            "total_return_pct": (equity - 1.0) * 100,
        }


def run_backtest(df: pd.DataFrame, config: StrategyConfig | None = None) -> BacktestResult:
    cfg = config or StrategyConfig()
    signals = generate_signals(df, cfg)

    result = BacktestResult()
    position: Trade | None = None
    highest_since_entry = None
    pending_entry_bar = None

    dates = signals.index
    n = len(signals)

    for i in range(n - 1):
        row = signals.iloc[i]

        if position is None and pending_entry_bar is None and bool(row["entry_long"]):
            pending_entry_bar = i + 1
            continue

        if position is None and pending_entry_bar == i:
            entry_price = float(row["open"])
            entry_atr = float(signals.iloc[i - 1]["atr"]) if i > 0 else float(row["atr"])
            stop = entry_price - cfg.stop_atr_mult * entry_atr
            target = entry_price + cfg.target_atr_mult * entry_atr
            position = Trade(
                entry_date=dates[i],
                entry_price=entry_price,
                entry_atr=entry_atr,
                initial_stop=stop,
                stop=stop,
                target=target,
            )
            highest_since_entry = row["high"]
            pending_entry_bar = None
            continue

        if position is not None:
            position.bars_held += 1
            highest_since_entry = max(highest_since_entry, row["high"])

            if highest_since_entry - position.entry_price >= cfg.trail_trigger_atr_mult * position.entry_atr:
                position.stop = max(position.stop, position.entry_price)

            if row["low"] <= position.stop:
                position.exit_date = dates[i]
                position.exit_price = position.stop
                position.exit_reason = "stop"
            elif row["high"] >= position.target:
                position.exit_date = dates[i]
                position.exit_price = position.target
                position.exit_reason = "target"
            elif bool(row["exit_signal_long"]):
                position.exit_date = dates[i]
                position.exit_price = row["close"]
                position.exit_reason = "signal"
            elif position.bars_held >= cfg.max_holding_bars:
                position.exit_date = dates[i]
                position.exit_price = row["close"]
                position.exit_reason = "timeout"

            if position.exit_price is not None:
                result.trades.append(position)
                position = None
                highest_since_entry = None

    if position is not None:
        last = signals.iloc[-1]
        position.exit_date = dates[-1]
        position.exit_price = last["close"]
        position.exit_reason = "end_of_data"
        result.trades.append(position)

    return result
