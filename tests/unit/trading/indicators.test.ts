/**
 * Unit tests for technical indicators
 */

import { assertEquals } from "../../test.utils.ts";
import { ema, rsi, sma } from "../../../src/trading/indicators.ts";
import type { Bar } from "../../../src/trading/types.ts";

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

Deno.test("sma() returns undefined before enough history", () => {
  const bars = makeBars([1, 2, 3]);
  assertEquals(sma(bars, 1, 3), undefined);
});

Deno.test("sma() computes the simple moving average", () => {
  const bars = makeBars([1, 2, 3, 4, 5]);
  assertEquals(sma(bars, 2, 3), 2); // (1+2+3)/3
  assertEquals(sma(bars, 4, 3), 4); // (3+4+5)/3
});

Deno.test("ema() equals sma() at the seed point", () => {
  const bars = makeBars([1, 2, 3, 4, 5]);
  assertEquals(ema(bars, 2, 3), sma(bars, 2, 3));
});

Deno.test("rsi() is 100 when there are no losses", () => {
  const bars = makeBars([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assertEquals(rsi(bars, 14, 14), 100);
});

Deno.test("rsi() is 0 when there are no gains", () => {
  const bars = makeBars([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assertEquals(rsi(bars, 14, 14), 0);
});

Deno.test("rsi() sits at 50 for an alternating flat series", () => {
  const closes = [10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10];
  const bars = makeBars(closes);
  const value = rsi(bars, 14, 14)!;
  assertEquals(Math.round(value), 50);
});
