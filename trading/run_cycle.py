#!/usr/bin/env python3
"""Driver for one scan cycle. Consumes pre-fetched ticker + candle data (the
MCP tool calls that produce it can only happen in the live session, not here)
and does the actual relative-volume analysis, trade entry, and exit checks.

Input JSON shape:
{
  "tickers": {"BTCUSD": {"last": 63469.64, "change_pct": 1.05, "volume_usd": 88051472.9}, ...},
  "candles": {
    "BTCUSD": {"1m": [{"volume": "2.24", ...}, ...newest first...], "5m": [...], ...},
    ...
  }
}

Usage: run_cycle.py <input.json>
Prints a JSON summary: {"opened": [...], "closed": [...], "checked": [...]}
"""
import json
import sys

import analysis
import journal


def timeframe_volumes(candles_newest_first):
    # API returns newest-first; relative_volume wants oldest-first with last = current.
    vols = []
    for c in reversed(candles_newest_first):
        try:
            vols.append(float(c["volume"]))
        except (KeyError, ValueError, TypeError):
            return []
    return vols


def main():
    data = json.load(open(sys.argv[1]))
    tickers = data.get("tickers", {})
    candles = data.get("candles", {})

    opened = []
    checked = []

    for symbol, tf_candles in candles.items():
        rel_vol_by_tf = {}
        for tf in analysis.TIMEFRAMES:
            vols = timeframe_volumes(tf_candles.get(tf, []))
            rel_vol_by_tf[tf] = analysis.relative_volume(vols)

        score, elevated = analysis.consensus_score(rel_vol_by_tf)
        ok, strong = analysis.qualifies(rel_vol_by_tf)
        checked.append({"symbol": symbol, "score": round(score, 2), "elevated_tfs": elevated, "qualifies": ok})

        if not ok:
            continue

        t = tickers.get(symbol)
        if not t:
            continue

        jdata = journal.load()
        if journal.has_open_trade(jdata, symbol):
            continue

        rationale = f"Relative volume >=3x on {len(strong)} timeframe(s): {', '.join(strong)}; consensus score {score:.1f}"
        trade, _ = journal.open_trade(
            symbol=symbol,
            entry_price=t["last"],
            stop_loss_pct=0.07,
            take_profit_pct=0.22,
            rationale=rationale,
            rel_vol_by_tf=rel_vol_by_tf,
            consensus_score=score,
        )
        if trade:
            opened.append(trade)

    # Exit check on ALL open trades (not just this cycle's candidates) using
    # whatever current price is available in the ticker dump.
    current_prices = {sym: t["last"] for sym, t in tickers.items()}
    closed = journal.check_open_trades(current_prices)

    print(json.dumps({"opened": opened, "closed": closed, "checked": checked}, indent=2))


if __name__ == "__main__":
    main()
