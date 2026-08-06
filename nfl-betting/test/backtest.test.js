import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrationBuckets, brierScore, favoriteAccuracy, spreadError, atsThresholdPerformance } from '../src/analysis/backtest.js';

test('calibrationBuckets sorts predictions into 10% probability bins and reports actual win rate', () => {
  const buckets = calibrationBuckets([
    { homeWinProb: 0.65, homeWon: true },
    { homeWinProb: 0.62, homeWon: false },
    { homeWinProb: 0.15, homeWon: false },
  ]);
  const b60 = buckets.find((b) => b.range === '60-70%');
  assert.equal(b60.n, 2);
  assert.equal(b60.actualWinRate, 50);
  const b10 = buckets.find((b) => b.range === '10-20%');
  assert.equal(b10.n, 1);
  assert.equal(b10.actualWinRate, 0);
  const b90 = buckets.find((b) => b.range === '90-100%');
  assert.equal(b90.n, 0);
  assert.equal(b90.actualWinRate, null);
});

test('calibrationBuckets clamps a homeWinProb of exactly 1.0 into the last bucket, not a nonexistent 11th', () => {
  const buckets = calibrationBuckets([{ homeWinProb: 1.0, homeWon: true }]);
  assert.equal(buckets[9].n, 1);
});

test('calibrationBuckets skips a NaN/out-of-range probability instead of crashing the whole report', () => {
  // Regression test: a real upstream data bug (ratings corrupted to NaN —
  // see ratingsStore.test.js) crashed this on `buckets[NaN].n += 1`. One
  // bad prediction shouldn't take down the whole calibration report.
  const buckets = calibrationBuckets([
    { homeWinProb: NaN, homeWon: true },
    { homeWinProb: -0.1, homeWon: true },
    { homeWinProb: 1.1, homeWon: false },
    { homeWinProb: 0.55, homeWon: true },
  ]);
  const total = buckets.reduce((s, b) => s + b.n, 0);
  assert.equal(total, 1); // only the valid 0.55 prediction counted
});

test('brierScore: 0 for a perfectly confident correct call, 1 for a perfectly confident wrong one', () => {
  assert.equal(brierScore([{ homeWinProb: 1, homeWon: true }]), 0);
  assert.equal(brierScore([{ homeWinProb: 0, homeWon: true }]), 1);
});

test('brierScore: 0.25 for always guessing a coin flip, the textbook "no skill" baseline', () => {
  const score = brierScore([{ homeWinProb: 0.5, homeWon: true }, { homeWinProb: 0.5, homeWon: false }]);
  assert.equal(score, 0.25);
});

test('brierScore returns null on an empty prediction set', () => {
  assert.equal(brierScore([]), null);
});

test('favoriteAccuracy: percent of games where the model\'s implied favorite actually won', () => {
  const pct = favoriteAccuracy([
    { homeWinProb: 0.7, homeWon: true }, // home favored, home won -> correct
    { homeWinProb: 0.3, homeWon: false }, // away favored, away won -> correct
    { homeWinProb: 0.6, homeWon: false }, // home favored, away won -> wrong
  ]);
  assert.ok(Math.abs(pct - 66.7) < 0.1);
});

test('favoriteAccuracy excludes true pick-em games (exactly 0.5) from the denominator', () => {
  const pct = favoriteAccuracy([{ homeWinProb: 0.5, homeWon: true }]);
  assert.equal(pct, null);
});

test('spreadError computes mean absolute error and signed bias', () => {
  const err = spreadError([
    { projectedSpread: 3, actualMargin: 7 }, // error -4
    { projectedSpread: -2, actualMargin: -5 }, // error +3
  ]);
  assert.equal(err.n, 2);
  assert.equal(err.mae, 3.5);
  assert.equal(err.bias, -0.5);
});

test('spreadError skips predictions missing either field', () => {
  const err = spreadError([{ projectedSpread: null, actualMargin: 7 }, { projectedSpread: 3, actualMargin: 7 }]);
  assert.equal(err.n, 1);
});

test('atsThresholdPerformance: cover math correctly credits home and away bets, and pushes', () => {
  const predictions = [
    { projectedSpread: 5, marketSpread: 2, actualMargin: 6 }, // model likes home more, bet home, actual margin 6 > market 2 -> covers
    { projectedSpread: 5, marketSpread: 2, actualMargin: 1 }, // bet home, actual margin 1 < market 2 -> loses
    { projectedSpread: -3, marketSpread: 0, actualMargin: 0 }, // model likes away more, bet away, market(0) - actual(0) = 0 -> push
  ];
  const results = atsThresholdPerformance(predictions, [0, 3, 4]);
  const at0 = results.find((r) => r.threshold === 0);
  assert.equal(at0.n, 3);
  assert.equal(at0.record, '1-1-1');
  assert.equal(at0.coverPct, 50);

  const at3 = results.find((r) => r.threshold === 3);
  assert.equal(at3.n, 3); // all three have exactly a 3-point gap, so >= 3 still includes them

  const at4 = results.find((r) => r.threshold === 4);
  assert.equal(at4.n, 0);
  assert.equal(at4.coverPct, null);
});

test('atsThresholdPerformance excludes predictions missing market or actual data', () => {
  const results = atsThresholdPerformance([{ projectedSpread: 5, marketSpread: null, actualMargin: 3 }], [0]);
  assert.equal(results[0].n, 0);
});
