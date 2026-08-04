import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizePenaltiesByGame,
  computeRefereeTendencies,
  leagueAveragePenaltiesPerGame,
  refereePenaltyRatio,
} from '../src/analysis/refereeTendencies.js';

const PBP_ROWS = [
  { old_game_id: 'g1', penalty: 1, penalty_yards: 10 },
  { old_game_id: 'g1', penalty: 1, penalty_yards: 5 },
  { old_game_id: 'g1', penalty: 0, penalty_yards: null },
  { old_game_id: 'g2', penalty: 1, penalty_yards: 15 },
  { old_game_id: 'g3', penalty: 0, penalty_yards: null }, // zero-penalty game still gets an entry
];

test('summarizePenaltiesByGame counts only penalty=1 rows and sums yards', () => {
  const summary = summarizePenaltiesByGame(PBP_ROWS);
  assert.deepEqual(summary.g1, { penalties: 2, penaltyYards: 15 });
  assert.deepEqual(summary.g2, { penalties: 1, penaltyYards: 15 });
  assert.deepEqual(summary.g3, { penalties: 0, penaltyYards: 0 });
});

test('summarizePenaltiesByGame ignores rows with no old_game_id', () => {
  const summary = summarizePenaltiesByGame([{ old_game_id: null, penalty: 1, penalty_yards: 10 }]);
  assert.deepEqual(summary, {});
});

const OFFICIALS = [
  { game_id: 'g1', official_name: 'Ref A', position: 'Referee' },
  { game_id: 'g2', official_name: 'Ref A', position: 'Referee' },
  { game_id: 'g3', official_name: 'Ref B', position: 'Referee' },
  { game_id: 'g1', official_name: 'Some Umpire', position: 'Umpire' }, // wrong position, excluded
  { game_id: 'g-missing', official_name: 'Ref A', position: 'Referee' }, // no game summary, excluded
];

test('computeRefereeTendencies averages penalties/yards per game for each head referee', () => {
  const summaries = summarizePenaltiesByGame(PBP_ROWS);
  const tendencies = computeRefereeTendencies(OFFICIALS, summaries);
  assert.equal(tendencies['Ref A'].games, 2);
  assert.equal(tendencies['Ref A'].penaltiesPerGame, 1.5); // (2+1)/2
  assert.equal(tendencies['Ref A'].penaltyYardsPerGame, 15); // (15+15)/2
  assert.equal(tendencies['Ref B'].games, 1);
  assert.equal(tendencies['Ref B'].penaltiesPerGame, 0);
  assert.equal(tendencies['Some Umpire'], undefined);
});

test('leagueAveragePenaltiesPerGame averages across every referee with data', () => {
  const summaries = summarizePenaltiesByGame(PBP_ROWS);
  const tendencies = computeRefereeTendencies(OFFICIALS, summaries);
  assert.equal(leagueAveragePenaltiesPerGame(tendencies), (1.5 + 0) / 2);
});

test('leagueAveragePenaltiesPerGame returns null with no data', () => {
  assert.equal(leagueAveragePenaltiesPerGame({}), null);
});

test('refereePenaltyRatio: above-average flag-thrower returns a ratio above 1', () => {
  assert.equal(refereePenaltyRatio({ penaltiesPerGame: 18 }, 15), 1.2);
  assert.equal(refereePenaltyRatio({ penaltiesPerGame: 12 }, 15), 0.8);
});

test('refereePenaltyRatio returns null when either input is missing', () => {
  assert.equal(refereePenaltyRatio(null, 15), null);
  assert.equal(refereePenaltyRatio({ penaltiesPerGame: 18 }, null), null);
});
