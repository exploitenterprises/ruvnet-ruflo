import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findStarterInjury,
  qbOutPenalty,
  starterInjuryNotes,
  QB_OUT_POINT_PENALTY,
} from '../src/analysis/injuryImpact.js';

function depthChart({ qbInjuries = [], rbInjuries = [] } = {}) {
  return [
    {
      name: '3WR 1TE',
      positions: {
        qb: { athletes: [{ id: '1', displayName: 'Starter QB', injuries: qbInjuries }, { id: '2', displayName: 'Backup QB', injuries: [] }] },
        rb: { athletes: [{ id: '3', displayName: 'Starter RB', injuries: rbInjuries }] },
      },
    },
  ];
}

test('findStarterInjury returns null when the starter has no injuries listed', () => {
  assert.equal(findStarterInjury(depthChart(), 'qb'), null);
});

test('findStarterInjury returns null when the starter has an injury entry that isn\'t a "not playing" status', () => {
  const dc = depthChart({ qbInjuries: [{ status: 'Questionable', date: '2026-09-01', note: 'ankle' }] });
  assert.equal(findStarterInjury(dc, 'qb'), null);
});

test('findStarterInjury reports the starter\'s Out/Doubtful/IR designation', () => {
  const dc = depthChart({ qbInjuries: [{ status: 'Out', date: '2026-09-01', note: 'knee surgery' }] });
  const injury = findStarterInjury(dc, 'qb');
  assert.equal(injury.player, 'Starter QB');
  assert.equal(injury.status, 'Out');
  assert.equal(injury.note, 'knee surgery');
});

test('findStarterInjury only looks at rank 1 (the backup\'s injury status is irrelevant)', () => {
  const dc = [{
    name: '3WR 1TE',
    positions: { qb: { athletes: [{ id: '1', displayName: 'Starter QB', injuries: [] }, { id: '2', displayName: 'Backup QB', injuries: [{ status: 'Out' }] }] } },
  }];
  assert.equal(findStarterInjury(dc, 'qb'), null);
});

test('findStarterInjury returns null for a position not present in the depth chart', () => {
  assert.equal(findStarterInjury(depthChart(), 'te'), null);
});

test('findStarterInjury handles a missing/undefined depth chart without crashing', () => {
  assert.equal(findStarterInjury(undefined, 'qb'), null);
  assert.equal(findStarterInjury([], 'qb'), null);
});

test('qbOutPenalty returns the flat penalty only when the starting QB is out, 0 otherwise', () => {
  assert.equal(qbOutPenalty(depthChart()), 0);
  assert.equal(qbOutPenalty(depthChart({ qbInjuries: [{ status: 'Doubtful' }] })), QB_OUT_POINT_PENALTY);
});

test('starterInjuryNotes surfaces informational notes for the requested positions, skipping healthy ones', () => {
  const dc = depthChart({ rbInjuries: [{ status: 'Injured Reserve', note: 'torn ACL' }] });
  const notes = starterInjuryNotes('KC', dc, ['qb', 'rb']);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /KC starting RB Starter RB is injured reserve — torn ACL/);
});
