import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyResults, seedSeasonRatings } from '../src/ratingsStore.js';

test('applyResults updates both teams\' ratings after a completed game', () => {
  const ratings = { A: 1500, B: 1500 };
  const next = applyResults(ratings, [{ home: { abbr: 'A', score: 27 }, away: { abbr: 'B', score: 17 }, neutralSite: false }]);
  assert.ok(next.A > 1500); // home team won, rating should rise
  assert.ok(next.B < 1500);
});

test('applyResults skips a game where either team has no existing rating, instead of corrupting both with NaN', () => {
  // Regression test: found via backtesting a real live bug — ESPN returns
  // "WSH" for Washington while this project's team table uses "WAS".
  // Before this fix, `undefined + number` (NaN) from the missing rating
  // corrupted BOTH teams, then cascaded to every team they played after.
  const ratings = { A: 1500 }; // 'WSH' (or any unknown abbr) has no entry
  const next = applyResults(ratings, [{ home: { abbr: 'A', score: 27 }, away: { abbr: 'WSH', score: 17 }, neutralSite: false }]);
  assert.equal(next.A, 1500); // untouched, not corrupted to NaN
  assert.equal(next.WSH, undefined); // never created as a NaN entry
});

test('applyResults skips games with a missing score without crashing', () => {
  const ratings = { A: 1500, B: 1500 };
  const next = applyResults(ratings, [{ home: { abbr: 'A', score: null }, away: { abbr: 'B', score: 17 }, neutralSite: false }]);
  assert.equal(next.A, 1500);
  assert.equal(next.B, 1500);
});

test('applyResults processes independent games in the same batch even if one is skipped', () => {
  const ratings = { A: 1500, B: 1500, C: 1500 };
  const next = applyResults(ratings, [
    { home: { abbr: 'A', score: 20 }, away: { abbr: 'UNKNOWN', score: 10 }, neutralSite: false },
    { home: { abbr: 'B', score: 24 }, away: { abbr: 'C', score: 21 }, neutralSite: false },
  ]);
  assert.equal(next.A, 1500); // skipped (unknown opponent)
  assert.ok(next.B > 1500); // processed normally
  assert.ok(next.C < 1500);
});

test('seedSeasonRatings falls back to league average (before regression) for a team with no prior-season data', () => {
  const ratings = seedSeasonRatings({});
  const values = Object.values(ratings);
  assert.ok(values.every((v) => Number.isFinite(v)));
  // No data -> diff of 0 -> seedRating(0) = LEAGUE_AVG_RATING, then regressed toward itself (no-op).
  assert.ok(values.every((v) => Math.abs(v - 1500) < 1e-9));
});
