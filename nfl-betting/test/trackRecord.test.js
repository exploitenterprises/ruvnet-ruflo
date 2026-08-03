import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeSummary, currentStreak, longestStreak, playerStreaks, netUnits } from '../src/analysis/trackRecord.js';

function pick(overrides = {}) {
  return { id: 'x', category: 'game', status: 'pending', ...overrides };
}

test('gradeSummary counts wins/losses/pushes/pending and computes win% over decided picks only', () => {
  const picks = [
    pick({ status: 'win' }), pick({ status: 'win' }), pick({ status: 'loss' }),
    pick({ status: 'push' }), pick({ status: 'pending' }),
  ];
  const summary = gradeSummary(picks);
  assert.equal(summary.wins, 2);
  assert.equal(summary.losses, 1);
  assert.equal(summary.pushes, 1);
  assert.equal(summary.pending, 1);
  assert.equal(summary.decided, 3);
  assert.ok(Math.abs(summary.winPct - 2 / 3) < 1e-9);
});

test('gradeSummary returns null winPct when nothing is decided yet', () => {
  const summary = gradeSummary([pick({ status: 'pending' }), pick({ status: 'push' })]);
  assert.equal(summary.winPct, null);
  assert.equal(summary.decided, 0);
});

test('gradeSummary scopes by category', () => {
  const picks = [
    pick({ category: 'game', status: 'win' }),
    pick({ category: 'game', status: 'loss' }),
    pick({ category: 'prop', status: 'win' }),
    pick({ category: 'prop', status: 'win' }),
  ];
  const games = gradeSummary(picks, 'game');
  const props = gradeSummary(picks, 'prop');
  assert.equal(games.decided, 2);
  assert.ok(Math.abs(games.winPct - 0.5) < 1e-9);
  assert.equal(props.decided, 2);
  assert.equal(props.winPct, 1);
});

test('currentStreak reads most-recently-settled picks and stops at the first break', () => {
  // oldest -> newest
  const picks = [pick({ status: 'loss' }), pick({ status: 'win' }), pick({ status: 'win' }), pick({ status: 'win' })];
  const streak = currentStreak(picks);
  assert.equal(streak.type, 'W');
  assert.equal(streak.count, 3);
});

test('currentStreak skips pushes without breaking the streak', () => {
  const picks = [pick({ status: 'loss' }), pick({ status: 'win' }), pick({ status: 'push' }), pick({ status: 'win' })];
  const streak = currentStreak(picks);
  assert.equal(streak.type, 'W');
  assert.equal(streak.count, 2);
});

test('currentStreak on an all-pending ledger is a no-streak state', () => {
  const streak = currentStreak([pick({ status: 'pending' }), pick({ status: 'pending' })]);
  assert.equal(streak.type, null);
  assert.equal(streak.count, 0);
});

test('longestStreak finds the best run of a given type across the whole history', () => {
  const picks = [
    pick({ status: 'win' }), pick({ status: 'win' }), pick({ status: 'loss' }),
    pick({ status: 'win' }), pick({ status: 'win' }), pick({ status: 'win' }), pick({ status: 'loss' }),
  ];
  assert.equal(longestStreak(picks, 'win'), 3);
  assert.equal(longestStreak(picks, 'loss'), 1);
});

test('playerStreaks surfaces only players currently on a win streak, hottest first', () => {
  const picks = [
    pick({ category: 'prop', player: 'Player A', market: 'rec yds', status: 'win' }),
    pick({ category: 'prop', player: 'Player A', market: 'rec yds', status: 'win' }),
    pick({ category: 'prop', player: 'Player A', market: 'rec yds', status: 'win' }),
    pick({ category: 'prop', player: 'Player B', market: 'rush yds', status: 'win' }),
    pick({ category: 'prop', player: 'Player B', market: 'rush yds', status: 'loss' }),
    pick({ category: 'prop', player: 'Player C', market: 'pass tds', status: 'loss' }),
  ];
  const streaks = playerStreaks(picks);
  assert.equal(streaks.length, 1);
  assert.equal(streaks[0].player, 'Player A');
  assert.equal(streaks[0].streak, 3);
});

test('playerStreaks ignores game picks (only props are player-attributed)', () => {
  const picks = [pick({ category: 'game', player: 'Team Pick', status: 'win' })];
  assert.equal(playerStreaks(picks).length, 0);
});

test('netUnits: a win pays units * (decimal odds - 1)', () => {
  // -110 -> decimal 1.9091 -> 3 units win pays 3 * 0.9091 = 2.727
  const total = netUnits([pick({ status: 'win', price: -110, units: 3 })]);
  assert.ok(Math.abs(total - 2.7272727) < 1e-4);
});

test('netUnits: a loss costs the full units staked, regardless of price', () => {
  const total = netUnits([pick({ status: 'loss', price: -110, units: 4 })]);
  assert.equal(total, -4);
});

test('netUnits: pushes and pending picks do not move the total', () => {
  const total = netUnits([
    pick({ status: 'push', price: -110, units: 5 }),
    pick({ status: 'pending', price: -110, units: 5 }),
  ]);
  assert.equal(total, 0);
});

test('netUnits: missing units defaults to 1 instead of being skipped', () => {
  const total = netUnits([pick({ status: 'loss', price: -110 })]);
  assert.equal(total, -1);
});

test('netUnits: plus-money wins pay more than the units risked', () => {
  // +150 -> decimal 2.5 -> 2 units win pays 2 * 1.5 = 3
  const total = netUnits([pick({ status: 'win', price: 150, units: 2 })]);
  assert.equal(total, 3);
});

test('netUnits sums across a mixed season and scopes by category', () => {
  const picks = [
    pick({ category: 'game', status: 'win', price: -110, units: 2 }),   // +1.818
    pick({ category: 'game', status: 'loss', price: -110, units: 1 }),  // -1
    pick({ category: 'prop', status: 'win', price: 120, units: 1 }),    // +1.2
  ];
  assert.ok(Math.abs(netUnits(picks) - (1.818181818 - 1 + 1.2)) < 1e-4);
  assert.ok(Math.abs(netUnits(picks, 'game') - (1.818181818 - 1)) < 1e-4);
  assert.ok(Math.abs(netUnits(picks, 'prop') - 1.2) < 1e-9);
});
