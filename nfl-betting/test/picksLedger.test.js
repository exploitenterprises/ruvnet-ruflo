import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPick, settlePick } from '../src/picksLedger.js';

test('addPick appends a new pick defaulting to pending status', () => {
  const picks = addPick([], { id: 'w1-BUF-spread', category: 'game', label: 'Bills @ Jets' });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].status, 'pending');
});

test('addPick is idempotent on duplicate ids', () => {
  const first = addPick([], { id: 'dup', category: 'game', label: 'x' });
  const second = addPick(first, { id: 'dup', category: 'game', label: 'x (different)' });
  assert.equal(second.length, 1);
  assert.equal(second[0].label, 'x');
});

test('settlePick updates status and settledDate for a matching id', () => {
  const picks = addPick([], { id: 'p1', category: 'prop', label: 'Player X' });
  const settled = settlePick(picks, 'p1', 'win', '2026-09-08');
  assert.equal(settled[0].status, 'win');
  assert.equal(settled[0].settledDate, '2026-09-08');
});

test('settlePick throws on an unknown id instead of silently no-op-ing', () => {
  assert.throws(() => settlePick([], 'missing', 'win', '2026-09-08'), /No pick with id/);
});
