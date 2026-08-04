import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPick, settlePick, revisePick, upsertPick } from '../src/picksLedger.js';

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

test('revisePick overwrites the call and records what it changed from', () => {
  const picks = addPick([], { id: 'p1', category: 'game', label: 'Bills @ Jets', market: 'spread', selection: 'BUF -3', price: -110, units: 2 });
  const revised = revisePick(picks, 'p1', { selection: 'NYJ +3', price: -105 }, { reason: 'starting QB ruled out' });
  assert.equal(revised[0].selection, 'NYJ +3');
  assert.equal(revised[0].price, -105);
  assert.equal(revised[0].status, 'pending');
  assert.equal(revised[0].revisions.length, 1);
  assert.equal(revised[0].revisions[0].from.selection, 'BUF -3');
  assert.equal(revised[0].revisions[0].reason, 'starting QB ruled out');
});

test('revisePick throws on an unknown id', () => {
  assert.throws(() => revisePick([], 'missing', { selection: 'x' }), /No pick with id/);
});

test('revisePick throws rather than editing an already-settled pick', () => {
  const picks = settlePick(addPick([], { id: 'p1', category: 'game', label: 'x', selection: 'A', price: -110 }), 'p1', 'win', '2026-09-08');
  assert.throws(() => revisePick(picks, 'p1', { selection: 'B' }), /already settled/);
});

test('upsertPick logs a new pick when the id is unseen', () => {
  const picks = upsertPick([], { id: 'p1', category: 'game', label: 'x', selection: 'A', price: -110 });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].selection, 'A');
});

test('upsertPick revises a pending pick when the selection or price changed', () => {
  const first = upsertPick([], { id: 'p1', category: 'game', label: 'x', selection: 'A', price: -110 });
  const second = upsertPick(first, { id: 'p1', category: 'game', label: 'x', selection: 'B', price: +120 }, { reason: 'model flipped' });
  assert.equal(second.length, 1);
  assert.equal(second[0].selection, 'B');
  assert.equal(second[0].revisions.length, 1);
});

test('upsertPick is a no-op when nothing material changed, so repeated runs don\'t pile up revisions', () => {
  const first = upsertPick([], { id: 'p1', category: 'game', label: 'x', selection: 'A', price: -110 });
  const second = upsertPick(first, { id: 'p1', category: 'game', label: 'x', selection: 'A', price: -110 });
  assert.equal(second[0].revisions, undefined);
});

test('upsertPick never touches an already-settled pick, even if the fresh entry disagrees', () => {
  const settled = settlePick(addPick([], { id: 'p1', category: 'game', label: 'x', selection: 'A', price: -110 }), 'p1', 'win', '2026-09-08');
  const result = upsertPick(settled, { id: 'p1', category: 'game', label: 'x', selection: 'B', price: -110 });
  assert.equal(result[0].selection, 'A');
  assert.equal(result[0].status, 'win');
});
