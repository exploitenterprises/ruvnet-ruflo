import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeWeightedHistory,
  aggregateByTeamPosition,
  teamPositionIndex,
  leaguePositionIndex,
  positionMatchupEdge,
  teamPositionRatio,
} from '../src/analysis/positionMatchup.js';

test('computeWeightedHistory weights the most recent season highest', () => {
  const v = computeWeightedHistory([
    { season: 2023, value: 0 },
    { season: 2024, value: 0 },
    { season: 2025, value: 10 },
  ], [0.5, 0.3, 0.2]);
  assert.ok(Math.abs(v - 5) < 1e-9);
});

test('computeWeightedHistory renormalizes when fewer seasons are available', () => {
  const v = computeWeightedHistory([{ season: 2025, value: 8 }], [0.5, 0.3, 0.2]);
  assert.equal(v, 8);
});

test('computeWeightedHistory ignores null/NaN values and returns null if nothing is left', () => {
  assert.equal(computeWeightedHistory([{ season: 2025, value: null }]), null);
  assert.equal(computeWeightedHistory([]), null);
});

const NGS_ROWS = [
  { team_abbr: 'KC', player_position: 'WR', season: 2024, week: 0, avg_separation: 3.0 },
  { team_abbr: 'KC', player_position: 'WR', season: 2024, week: 0, avg_separation: 2.6 },
  { team_abbr: 'KC', player_position: 'WR', season: 2025, week: 0, avg_separation: 3.4 },
  { team_abbr: 'BUF', player_position: 'WR', season: 2024, week: 0, avg_separation: 2.0 },
  { team_abbr: 'BUF', player_position: 'WR', season: 2025, week: 0, avg_separation: 2.2 },
  // mid-season row (week != 0) should be excluded from season aggregates
  { team_abbr: 'KC', player_position: 'WR', season: 2025, week: 4, avg_separation: 99 },
];

test('aggregateByTeamPosition averages only season-long (week 0) rows for the team/position/season', () => {
  const v = aggregateByTeamPosition(NGS_ROWS, { team: 'KC', position: 'WR', season: 2024, metric: 'avg_separation' });
  assert.ok(Math.abs(v - 2.8) < 1e-9);
});

test('aggregateByTeamPosition returns null when there is no matching data', () => {
  const v = aggregateByTeamPosition(NGS_ROWS, { team: 'MIA', position: 'WR', season: 2024, metric: 'avg_separation' });
  assert.equal(v, null);
});

test('teamPositionIndex blends multiple seasons for a team/position/metric', () => {
  const v = teamPositionIndex(NGS_ROWS, { team: 'KC', position: 'WR', seasons: [2024, 2025], metric: 'avg_separation', weights: [0.6, 0.4] });
  // 2025=3.4 weighted 0.6, 2024=2.8 weighted 0.4
  assert.ok(Math.abs(v - (3.4 * 0.6 + 2.8 * 0.4)) < 1e-9);
});

test('leaguePositionIndex averages across all teams at a position', () => {
  const v = leaguePositionIndex(NGS_ROWS, { position: 'WR', seasons: [2024, 2025], weights: [0.6, 0.4], metric: 'avg_separation' });
  assert.ok(v > 2 && v < 3.5);
});

test('teamPositionRatio: a team above the league average returns a ratio above 1', () => {
  const kc = teamPositionRatio(NGS_ROWS, { team: 'KC', position: 'WR', seasons: [2024, 2025], metric: 'avg_separation', weights: [0.6, 0.4] });
  const buf = teamPositionRatio(NGS_ROWS, { team: 'BUF', position: 'WR', seasons: [2024, 2025], metric: 'avg_separation', weights: [0.6, 0.4] });
  assert.ok(kc > 1);
  assert.ok(buf < 1);
});

test('positionMatchupEdge multiplies offense strength by defense weakness (ratio family, same as passRushMismatch)', () => {
  assert.ok(Math.abs(positionMatchupEdge(1.2, 1.1) - 1.32) < 1e-9);
  assert.equal(positionMatchupEdge(null, 1.1), null);
  assert.equal(positionMatchupEdge(1.2, null), null);
});
