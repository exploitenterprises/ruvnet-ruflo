/**
 * Paper-trading backtest engine.
 *
 * Simulates a single-position long-only strategy against historical bars.
 * No real orders are ever placed - this only produces a simulated equity
 * curve and trade log for research purposes.
 */

import type {
  BacktestOptions,
  BacktestResult,
  Bar,
  EquityPoint,
  Strategy,
  StrategyParams,
  Trade,
} from "./types.ts";

const TRADING_DAYS_PER_YEAR = 252;

export const DEFAULT_BACKTEST_OPTIONS: BacktestOptions = {
  initialCapital: 10_000,
  positionSize: 1,
  feeRate: 0.001, // 10 bps per trade, covers commission + slippage
};

export function runBacktest(
  bars: Bar[],
  strategy: Strategy,
  params: StrategyParams = strategy.defaultParams,
  options: BacktestOptions = DEFAULT_BACKTEST_OPTIONS,
): BacktestResult {
  if (bars.length < 2) {
    throw new Error("Need at least 2 bars to run a backtest");
  }

  let cash = options.initialCapital;
  let quantity = 0;
  let entryPrice = 0;
  let entryDate = "";

  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const signal = strategy.signalAt(bars, i, params);

    if (signal === "buy" && quantity === 0) {
      const budget = cash * options.positionSize;
      const fee = budget * options.feeRate;
      quantity = (budget - fee) / bar.close;
      cash -= budget;
      entryPrice = bar.close;
      entryDate = bar.date;
    } else if (signal === "sell" && quantity > 0) {
      const proceeds = quantity * bar.close;
      const fee = proceeds * options.feeRate;
      cash += proceeds - fee;

      const pnl = proceeds - fee - quantity * entryPrice;
      trades.push({
        entryDate,
        entryPrice,
        exitDate: bar.date,
        exitPrice: bar.close,
        quantity,
        pnl,
        returnPct: (bar.close * (1 - options.feeRate) / entryPrice - 1) * 100,
      });

      quantity = 0;
      entryPrice = 0;
      entryDate = "";
    }

    const equity = cash + quantity * bar.close;
    equityCurve.push({ date: bar.date, equity });
  }

  // Close any still-open position at the last bar so the backtest is fully
  // realized (mark-to-market close, not a live order).
  if (quantity > 0) {
    const last = bars[bars.length - 1];
    const proceeds = quantity * last.close;
    const fee = proceeds * options.feeRate;
    cash += proceeds - fee;

    trades.push({
      entryDate,
      entryPrice,
      exitDate: last.date,
      exitPrice: last.close,
      quantity,
      pnl: proceeds - fee - quantity * entryPrice,
      returnPct: (last.close * (1 - options.feeRate) / entryPrice - 1) * 100,
    });

    quantity = 0;
    equityCurve[equityCurve.length - 1] = { date: last.date, equity: cash };
  }

  const endingCapital = cash;
  const metrics = computeMetrics(equityCurve, trades, options.initialCapital, endingCapital);

  return {
    strategyName: strategy.name,
    symbol: "",
    params,
    trades,
    equityCurve,
    metrics,
  };
}

function computeMetrics(
  equityCurve: EquityPoint[],
  trades: Trade[],
  startingCapital: number,
  endingCapital: number,
): BacktestResult["metrics"] {
  const totalReturnPct = (endingCapital / startingCapital - 1) * 100;

  const years = equityCurve.length / TRADING_DAYS_PER_YEAR;
  const cagrPct = years > 0
    ? (Math.pow(endingCapital / startingCapital, 1 / years) - 1) * 100
    : 0;

  const maxDrawdownPct = computeMaxDrawdown(equityCurve);
  const sharpeRatio = computeSharpeRatio(equityCurve);

  const winningTrades = trades.filter((t) => t.pnl > 0).length;
  const winRatePct = trades.length > 0 ? (winningTrades / trades.length) * 100 : 0;
  const avgTradeReturnPct = trades.length > 0
    ? trades.reduce((sum, t) => sum + t.returnPct, 0) / trades.length
    : 0;

  return {
    startingCapital,
    endingCapital,
    totalReturnPct,
    cagrPct,
    maxDrawdownPct,
    sharpeRatio,
    winRatePct,
    tradeCount: trades.length,
    avgTradeReturnPct,
  };
}

function computeMaxDrawdown(equityCurve: EquityPoint[]): number {
  let peak = -Infinity;
  let maxDrawdown = 0;

  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity;
    const drawdown = peak > 0 ? (peak - point.equity) / peak : 0;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  return maxDrawdown * 100;
}

function computeSharpeRatio(equityCurve: EquityPoint[]): number {
  if (equityCurve.length < 2) return 0;

  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    const curr = equityCurve[i].equity;
    dailyReturns.push(prev > 0 ? curr / prev - 1 : 0);
  }

  const mean = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / dailyReturns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;
  return (mean / stdDev) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}
