/**
 * Unit tests for the paper-trading backtester
 */

import { assertEquals, assertThrows } from "../../test.utils.ts";
import { runBacktest } from "../../../src/trading/backtester.ts";
import type { Bar, Signal, Strategy } from "../../../src/trading/types.ts";

function makeBars(closes: number[]): Bar[] {
  return closes.map((close, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, "0")}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  }));
}

/** Deterministic scripted strategy: emits a fixed signal sequence, by index. */
function scriptedStrategy(signals: Signal[]): Strategy {
  return {
    name: "scripted",
    defaultParams: {},
    signalAt: (_bars, i) => signals[i] ?? "hold",
  };
}

Deno.test("runBacktest throws with fewer than 2 bars", () => {
  const bars = makeBars([100]);
  const strategy = scriptedStrategy(["hold"]);
  assertThrows(() => runBacktest(bars, strategy, {}, {
    initialCapital: 1000,
    positionSize: 1,
    feeRate: 0,
  }));
});

Deno.test("runBacktest with no signals never trades and preserves capital", () => {
  const bars = makeBars([100, 101, 102, 103]);
  const strategy = scriptedStrategy(["hold", "hold", "hold", "hold"]);
  const result = runBacktest(bars, strategy, {}, {
    initialCapital: 1000,
    positionSize: 1,
    feeRate: 0,
  });

  assertEquals(result.trades.length, 0);
  assertEquals(result.metrics.endingCapital, 1000);
  assertEquals(result.metrics.totalReturnPct, 0);
});

Deno.test("runBacktest computes a single buy/sell round trip with zero fees", () => {
  // buy at 100 on day 0, sell at 110 on day 1: a clean 10% gain.
  const bars = makeBars([100, 110]);
  const strategy = scriptedStrategy(["buy", "sell"]);
  const result = runBacktest(bars, strategy, {}, {
    initialCapital: 1000,
    positionSize: 1,
    feeRate: 0,
  });

  assertEquals(result.trades.length, 1);
  assertEquals(result.trades[0].entryPrice, 100);
  assertEquals(result.trades[0].exitPrice, 110);
  assertEquals(result.metrics.endingCapital, 1100);
  assertEquals(Math.round(result.metrics.totalReturnPct * 100) / 100, 10);
  assertEquals(result.metrics.winRatePct, 100);
});

Deno.test("runBacktest applies fees on entry and exit", () => {
  const bars = makeBars([100, 110]);
  const strategy = scriptedStrategy(["buy", "sell"]);
  const result = runBacktest(bars, strategy, {}, {
    initialCapital: 1000,
    positionSize: 1,
    feeRate: 0.01, // 1% each way
  });

  // Entry: spend 1000, fee 10 -> buy 990 worth -> 9.9 shares.
  // Exit: proceeds 9.9 * 110 = 1089, fee 10.89 -> cash 1078.11.
  assertEquals(Math.round(result.metrics.endingCapital * 100) / 100, 1078.11);
});

Deno.test("runBacktest auto-closes a position still open on the final bar", () => {
  const bars = makeBars([100, 105, 120]);
  const strategy = scriptedStrategy(["buy", "hold", "hold"]);
  const result = runBacktest(bars, strategy, {}, {
    initialCapital: 1000,
    positionSize: 1,
    feeRate: 0,
  });

  assertEquals(result.trades.length, 1);
  assertEquals(result.trades[0].exitPrice, 120);
  assertEquals(result.metrics.endingCapital, 1200);
});

Deno.test("runBacktest ignores a buy signal while already in a position", () => {
  const bars = makeBars([100, 105, 110]);
  const strategy = scriptedStrategy(["buy", "buy", "sell"]);
  const result = runBacktest(bars, strategy, {}, {
    initialCapital: 1000,
    positionSize: 1,
    feeRate: 0,
  });

  // Only one position should ever be opened despite two consecutive buy signals.
  assertEquals(result.trades.length, 1);
  assertEquals(result.trades[0].entryPrice, 100);
});

Deno.test("runBacktest reports max drawdown from the equity curve", () => {
  // Equity path implied by holding through the whole series: 100 -> 50 -> 150.
  const bars = makeBars([100, 50, 150]);
  const strategy = scriptedStrategy(["buy", "hold", "hold"]);
  const result = runBacktest(bars, strategy, {}, {
    initialCapital: 100,
    positionSize: 1,
    feeRate: 0,
  });

  assertEquals(result.metrics.maxDrawdownPct, 50);
});
