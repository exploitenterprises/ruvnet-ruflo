import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalCdf, coverProbability, overProbability } from '../src/analysis/statMath.js';

test('normalCdf at the mean is 0.5', () => {
  assert.ok(Math.abs(normalCdf(10, 10, 5) - 0.5) < 1e-6);
});

test('normalCdf is monotonically increasing', () => {
  assert.ok(normalCdf(1, 0, 1) > normalCdf(0, 0, 1));
  assert.ok(normalCdf(-1, 0, 1) < normalCdf(0, 0, 1));
});

test('coverProbability: a big favorite with a big cushion covers most of the time', () => {
  // Projected to win by 10, needs to win by only 3 -> should cover more often than not.
  const p = coverProbability(10, -3);
  assert.ok(p > 0.65);
});

test('coverProbability: pick-em line on a pick-em projection is ~50%', () => {
  const p = coverProbability(0, 0);
  assert.ok(Math.abs(p - 0.5) < 1e-6);
});

test('overProbability: projected total well above the line clears most of the time', () => {
  const p = overProbability(55, 42);
  assert.ok(p > 0.85);
});

test('overProbability: projected total well below the line rarely clears', () => {
  const p = overProbability(30, 48);
  assert.ok(p < 0.15);
});
