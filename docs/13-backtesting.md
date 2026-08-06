# Strategy Backtester

A paper-trading backtest engine for evaluating trading strategies against
historical price data. It exists to let you research whether an idea has
merit before ever risking real money on it.

**This tool never places real orders.** It reads historical bars, simulates
a long-only strategy, and reports what would have happened. Nothing here is
financial advice, and past performance on historical data does not predict
future returns.

## Quick start

```bash
# Fetch live history from Alpha Vantage and backtest the default strategy
export ALPHAVANTAGE_API_KEY=your_key_here
npx claude-flow backtest --symbol AAPL

# Or run against your own historical CSV (date,open,high,low,close,volume)
npx claude-flow backtest --data-file ./aapl-2023.csv --strategy rsi-mean-reversion
```

## Strategies

- **`sma-crossover`** (default) - buys when the fast simple moving average
  crosses above the slow one, sells on the reverse cross.
  Params: `--fast-period` (default 10), `--slow-period` (default 30).
- **`rsi-mean-reversion`** - buys when RSI drops below the oversold
  threshold, sells once it recovers above the overbought threshold.
  Params: `--rsi-period` (default 14), `--oversold` (default 30),
  `--overbought` (default 70).

## Simulation model

- Single position, long-only: a `buy` signal is ignored while already
  holding, and a `sell` signal is ignored while flat.
- `--position-size` controls how much of current equity is committed per
  trade (1 = all-in).
- `--fee-rate` is deducted from both the entry and exit as a stand-in for
  commissions and slippage.
- Any position still open on the final bar is closed at that bar's price so
  every backtest ends fully realized.

## Metrics reported

| Metric | Meaning |
|---|---|
| Total return | Ending vs. starting paper capital |
| CAGR | Annualized return, assuming 252 trading days/year |
| Max drawdown | Largest peak-to-trough decline in the equity curve |
| Sharpe ratio | Annualized mean/stdev of daily returns |
| Win rate | Percentage of closed trades with positive P&L |

## Programmatic use

The engine is also usable directly from TypeScript/Deno code, independent
of the CLI:

```ts
import {
  runBacktest,
  getStrategy,
  fetchAlphaVantageDailyBars,
} from "./src/trading/index.ts";

const bars = await fetchAlphaVantageDailyBars("AAPL");
const strategy = getStrategy("sma-crossover");
const result = runBacktest(bars, strategy, { fastPeriod: 10, slowPeriod: 30 }, {
  initialCapital: 10_000,
  positionSize: 1,
  feeRate: 0.001,
});

console.log(result.metrics);
```

## Extending it

Strategies are plain objects implementing the `Strategy` interface in
`src/trading/types.ts` - a `signalAt(bars, i, params)` function that looks
at history up to bar `i` and returns `"buy" | "sell" | "hold"`. Add a new
one in `src/trading/strategies.ts` and register it in the `strategies` map
to make it available via `--strategy <name>`.
