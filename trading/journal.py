#!/usr/bin/env python3
"""Paper-trading journal for the crypto relative-volume swing pipeline.

Storage: trading/data/journal.json. No real orders are ever placed here —
this only tracks hypothetical entries/exits derived from signals so we can
measure win rate and average gain over time.
"""
import json
import os
import sys
import time
from datetime import datetime, timezone

JOURNAL_PATH = os.path.join(os.path.dirname(__file__), "data", "journal.json")


def load():
    if not os.path.exists(JOURNAL_PATH):
        return {"trades": []}
    with open(JOURNAL_PATH) as f:
        return json.load(f)


def save(data):
    os.makedirs(os.path.dirname(JOURNAL_PATH), exist_ok=True)
    with open(JOURNAL_PATH, "w") as f:
        json.dump(data, f, indent=2)


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def has_open_trade(data, symbol):
    return any(t["symbol"] == symbol and t["status"] == "open" for t in data["trades"])


def open_trade(symbol, entry_price, stop_loss_pct, take_profit_pct, rationale, rel_vol_by_tf, consensus_score):
    """Open a new paper trade. stop_loss_pct/take_profit_pct are positive fractions, e.g. 0.07 for 7%."""
    data = load()
    if has_open_trade(data, symbol):
        return None, data
    trade = {
        "id": f"{symbol}-{int(time.time())}",
        "symbol": symbol,
        "status": "open",
        "entry_price": entry_price,
        "entry_time": _now_iso(),
        "stop_loss_price": round(entry_price * (1 - stop_loss_pct), 10),
        "take_profit_price": round(entry_price * (1 + take_profit_pct), 10),
        "stop_loss_pct": stop_loss_pct,
        "take_profit_pct": take_profit_pct,
        "rationale": rationale,
        "rel_vol_by_tf": rel_vol_by_tf,
        "consensus_score": consensus_score,
        "exit_price": None,
        "exit_time": None,
        "exit_reason": None,
        "pnl_pct": None,
    }
    data["trades"].append(trade)
    save(data)
    return trade, data


def check_open_trades(current_prices):
    """current_prices: {symbol: last_price}. Closes trades that hit stop or target. Returns list of closed trades."""
    data = load()
    closed = []
    for t in data["trades"]:
        if t["status"] != "open":
            continue
        price = current_prices.get(t["symbol"])
        if price is None:
            continue
        if price <= t["stop_loss_price"]:
            t["status"] = "closed"
            t["exit_price"] = price
            t["exit_time"] = _now_iso()
            t["exit_reason"] = "stop_loss"
            t["pnl_pct"] = round((price - t["entry_price"]) / t["entry_price"] * 100, 2)
            closed.append(t)
        elif price >= t["take_profit_price"]:
            t["status"] = "closed"
            t["exit_price"] = price
            t["exit_time"] = _now_iso()
            t["exit_reason"] = "take_profit"
            t["pnl_pct"] = round((price - t["entry_price"]) / t["entry_price"] * 100, 2)
            closed.append(t)
    if closed:
        save(data)
    return closed


def stats():
    data = load()
    closed = [t for t in data["trades"] if t["status"] == "closed"]
    open_trades = [t for t in data["trades"] if t["status"] == "open"]
    wins = [t for t in closed if t["pnl_pct"] > 0]
    win_rate = round(len(wins) / len(closed) * 100, 1) if closed else None
    avg_gain = round(sum(t["pnl_pct"] for t in closed) / len(closed), 2) if closed else None
    return {
        "open_count": len(open_trades),
        "closed_count": len(closed),
        "win_rate_pct": win_rate,
        "avg_pnl_pct": avg_gain,
        "open_trades": open_trades,
        "closed_trades": sorted(closed, key=lambda t: t["exit_time"], reverse=True),
    }


if __name__ == "__main__":
    # CLI: journal.py stats | journal.py check <prices.json>
    if len(sys.argv) < 2:
        print("usage: journal.py stats | journal.py check <prices.json>")
        sys.exit(1)
    if sys.argv[1] == "stats":
        print(json.dumps(stats(), indent=2))
    elif sys.argv[1] == "check":
        with open(sys.argv[2]) as f:
            prices = json.load(f)
        print(json.dumps(check_open_trades(prices), indent=2))
