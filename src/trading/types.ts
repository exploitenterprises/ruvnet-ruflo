/**
 * Shared types for the paper-trading backtester.
 *
 * Nothing in this module places real orders or moves real money -
 * it only simulates strategies against historical price data.
 */

export interface Bar {
  date: string; // ISO date, e.g. "2024-01-02"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Signal = "buy" | "sell" | "hold";

export interface StrategyParams {
  [key: string]: number;
}

export interface Strategy {
  name: string;
  /** Given all bars up to and including index i, decide what to do next. */
  signalAt: (bars: Bar[], i: number, params: StrategyParams) => Signal;
  defaultParams: StrategyParams;
}

export interface Trade {
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  quantity: number;
  pnl: number;
  returnPct: number;
}

export interface BacktestOptions {
  initialCapital: number;
  /** Fraction of equity risked per trade, e.g. 1 = all-in, 0.5 = half. */
  positionSize: number;
  /** Round-trip commission + slippage, expressed as a fraction of trade value. */
  feeRate: number;
}

export interface EquityPoint {
  date: string;
  equity: number;
}

export interface BacktestResult {
  strategyName: string;
  symbol: string;
  params: StrategyParams;
  trades: Trade[];
  equityCurve: EquityPoint[];
  metrics: {
    startingCapital: number;
    endingCapital: number;
    totalReturnPct: number;
    cagrPct: number;
    maxDrawdownPct: number;
    sharpeRatio: number;
    winRatePct: number;
    tradeCount: number;
    avgTradeReturnPct: number;
  };
}
