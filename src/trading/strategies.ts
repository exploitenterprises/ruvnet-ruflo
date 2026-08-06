/**
 * Concrete trading strategies for the backtester.
 * Each strategy is a pure function: (history, index, params) -> signal.
 */

import type { Bar, Signal, Strategy } from "./types.ts";
import { rsi, sma } from "./indicators.ts";

/**
 * Classic dual moving-average crossover:
 * buy when the fast SMA crosses above the slow SMA, sell on the reverse cross.
 */
export const smaCrossoverStrategy: Strategy = {
  name: "sma-crossover",
  defaultParams: { fastPeriod: 10, slowPeriod: 30 },
  signalAt(bars: Bar[], i: number, params): Signal {
    const { fastPeriod, slowPeriod } = params;
    if (i < 1) return "hold";

    const fastNow = sma(bars, i, fastPeriod);
    const slowNow = sma(bars, i, slowPeriod);
    const fastPrev = sma(bars, i - 1, fastPeriod);
    const slowPrev = sma(bars, i - 1, slowPeriod);

    if (fastNow === undefined || slowNow === undefined ||
        fastPrev === undefined || slowPrev === undefined) {
      return "hold";
    }

    const crossedUp = fastPrev <= slowPrev && fastNow > slowNow;
    const crossedDown = fastPrev >= slowPrev && fastNow < slowNow;

    if (crossedUp) return "buy";
    if (crossedDown) return "sell";
    return "hold";
  },
};

/**
 * RSI mean-reversion: buy when RSI dips below the oversold threshold,
 * sell once it recovers above the overbought threshold.
 */
export const rsiMeanReversionStrategy: Strategy = {
  name: "rsi-mean-reversion",
  defaultParams: { period: 14, oversold: 30, overbought: 70 },
  signalAt(bars: Bar[], i: number, params): Signal {
    const { period, oversold, overbought } = params;
    const value = rsi(bars, i, period);
    if (value === undefined) return "hold";

    if (value < oversold) return "buy";
    if (value > overbought) return "sell";
    return "hold";
  },
};

export const strategies: Record<string, Strategy> = {
  [smaCrossoverStrategy.name]: smaCrossoverStrategy,
  [rsiMeanReversionStrategy.name]: rsiMeanReversionStrategy,
};

export function getStrategy(name: string): Strategy {
  const strategy = strategies[name];
  if (!strategy) {
    const available = Object.keys(strategies).join(", ");
    throw new Error(`Unknown strategy "${name}". Available: ${available}`);
  }
  return strategy;
}
