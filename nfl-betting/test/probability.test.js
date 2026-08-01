import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  americanToImplied, americanToDecimal, impliedToAmerican,
  removeVigTwoWay, removeVigMultiWay, expectedValue, edgePercent, kellyStake,
  winProbFromRatingDiff,
} from '../src/analysis/probability.js';

test('americanToImplied: even money and standard juice', () => {
  assert.equal(americanToImplied(100), 0.5);
  assert.ok(Math.abs(americanToImplied(-110) - 0.5238) < 0.001);
  assert.ok(Math.abs(americanToImplied(150) - 0.4) < 0.001);
});

test('americanToDecimal matches implied probability inverse', () => {
  assert.ok(Math.abs(americanToDecimal(100) - 2.0) < 1e-9);
  assert.ok(Math.abs(americanToDecimal(-200) - 1.5) < 1e-9);
});

test('impliedToAmerican round-trips with americanToImplied', () => {
  for (const odds of [-250, -110, 120, 300]) {
    const p = americanToImplied(odds);
    const back = impliedToAmerican(p);
    assert.ok(Math.abs(back - odds) <= 1, `expected ~${odds}, got ${back}`);
  }
});

test('removeVigTwoWay normalizes a standard -110/-110 market to 50/50', () => {
  const { probA, probB } = removeVigTwoWay(-110, -110);
  assert.ok(Math.abs(probA - 0.5) < 1e-9);
  assert.ok(Math.abs(probB - 0.5) < 1e-9);
  assert.ok(Math.abs(probA + probB - 1) < 1e-9);
});

test('removeVigMultiWay sums to 1 across futures field', () => {
  const { probs } = removeVigMultiWay([150, 300, 500, 1000, 2000]);
  const sum = probs.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('expectedValue is positive when true prob exceeds implied prob', () => {
  // -110 implies ~52.4%; a true 60% win rate should be solidly +EV.
  const ev = expectedValue(0.6, -110, 100);
  assert.ok(ev > 0);
});

test('expectedValue is negative when true prob is below implied prob', () => {
  const ev = expectedValue(0.45, -110, 100);
  assert.ok(ev < 0);
});

test('edgePercent reflects the gap between model and book-implied probability', () => {
  const edge = edgePercent(0.55, 100); // implied 50%
  assert.ok(Math.abs(edge - 5) < 0.01);
});

test('kellyStake returns ~0 for a no-edge bet and positive for a real edge', () => {
  const noEdge = kellyStake(americanToImplied(-110), -110);
  assert.ok(noEdge < 1e-6);
  const edge = kellyStake(0.6, -110);
  assert.ok(edge > 0);
});

test('kellyStake never exceeds full bankroll fraction and respects fractional haircut', () => {
  const full = kellyStake(0.9, 100, 1);
  const quarter = kellyStake(0.9, 100, 0.25);
  assert.ok(full <= 1);
  assert.ok(Math.abs(quarter - full * 0.25) < 1e-9);
});

test('winProbFromRatingDiff is 0.5 at zero differential and monotonic', () => {
  assert.ok(Math.abs(winProbFromRatingDiff(0) - 0.5) < 1e-9);
  assert.ok(winProbFromRatingDiff(200) > winProbFromRatingDiff(0));
  assert.ok(winProbFromRatingDiff(-200) < winProbFromRatingDiff(0));
});
