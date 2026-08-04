import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordSnapshot, computeMovement, describeMovement } from '../src/analysis/lineMovement.js';

test('recordSnapshot appends a new entry for a game with no prior history', () => {
  const history = recordSnapshot({}, 'B@A', { spread: -3, total: 44 }, '2026-09-01T00:00:00Z');
  assert.equal(history['B@A'].length, 1);
  assert.equal(history['B@A'][0].spread, -3);
});

test('recordSnapshot is a no-op when the line hasn\'t changed since the last snapshot', () => {
  let history = recordSnapshot({}, 'B@A', { spread: -3, total: 44 }, '2026-09-01T00:00:00Z');
  history = recordSnapshot(history, 'B@A', { spread: -3, total: 44 }, '2026-09-02T00:00:00Z');
  assert.equal(history['B@A'].length, 1); // still just the one entry
});

test('recordSnapshot appends a new entry when the line moved', () => {
  let history = recordSnapshot({}, 'B@A', { spread: -3, total: 44 }, '2026-09-01T00:00:00Z');
  history = recordSnapshot(history, 'B@A', { spread: -4.5, total: 44 }, '2026-09-02T00:00:00Z');
  assert.equal(history['B@A'].length, 2);
  assert.equal(history['B@A'][1].spread, -4.5);
});

test('computeMovement returns null with fewer than two snapshots', () => {
  const history = recordSnapshot({}, 'B@A', { spread: -3, total: 44 }, '2026-09-01T00:00:00Z');
  assert.equal(computeMovement(history, 'B@A'), null);
  assert.equal(computeMovement({}, 'missing'), null);
});

test('computeMovement diffs the earliest and latest snapshot', () => {
  let history = recordSnapshot({}, 'B@A', { spread: -3, total: 44 }, '2026-09-01T00:00:00Z');
  history = recordSnapshot(history, 'B@A', { spread: -3, total: 46.5 }, '2026-09-03T00:00:00Z');
  history = recordSnapshot(history, 'B@A', { spread: -5, total: 46.5 }, '2026-09-05T00:00:00Z');
  const movement = computeMovement(history, 'B@A');
  assert.equal(movement.openSpread, -3);
  assert.equal(movement.currentSpread, -5);
  assert.equal(movement.spreadMove, -2);
  assert.equal(movement.openTotal, 44);
  assert.equal(movement.currentTotal, 46.5);
  assert.equal(movement.totalMove, 2.5);
  assert.equal(movement.snapshotCount, 3);
});

test('describeMovement only surfaces moves at or above the notable threshold', () => {
  const tinyMove = { spreadMove: 0.2, openSpread: -3, currentSpread: -3.2, totalMove: null, openTotal: null, currentTotal: null };
  assert.deepEqual(describeMovement('B@A', tinyMove), []);

  const realMove = { spreadMove: -2, openSpread: -3, currentSpread: -5, totalMove: 2.5, openTotal: 44, currentTotal: 46.5 };
  const notes = describeMovement('B@A', realMove);
  assert.equal(notes.length, 2);
  assert.match(notes[0], /spread has moved 2 pts toward the away side/);
  assert.match(notes[1], /total has moved up 2.5 pts/);
});

test('describeMovement returns nothing for a null movement (not enough history yet)', () => {
  assert.deepEqual(describeMovement('B@A', null), []);
});
