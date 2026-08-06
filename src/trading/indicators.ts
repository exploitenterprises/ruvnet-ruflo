/**
 * Technical indicator helpers used by trading strategies.
 * Each function returns `undefined` where there isn't enough history yet.
 */

import type { Bar } from "./types.ts";

export function sma(bars: Bar[], i: number, period: number): number | undefined {
  if (i < period - 1) return undefined;
  let sum = 0;
  for (let j = i - period + 1; j <= i; j++) {
    sum += bars[j].close;
  }
  return sum / period;
}

export function ema(bars: Bar[], i: number, period: number): number | undefined {
  if (i < period - 1) return undefined;
  const k = 2 / (period + 1);
  let prev = sma(bars, period - 1, period);
  if (prev === undefined) return undefined;
  for (let j = period; j <= i; j++) {
    prev = bars[j].close * k + prev * (1 - k);
  }
  return prev;
}

/** Relative Strength Index (Wilder's smoothing), classic 0-100 scale. */
export function rsi(bars: Bar[], i: number, period: number): number | undefined {
  if (i < period) return undefined;

  let gainSum = 0;
  let lossSum = 0;
  for (let j = i - period + 1; j <= i; j++) {
    const change = bars[j].close - bars[j - 1].close;
    if (change >= 0) {
      gainSum += change;
    } else {
      lossSum += -change;
    }
  }

  const avgGain = gainSum / period;
  const avgLoss = lossSum / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
