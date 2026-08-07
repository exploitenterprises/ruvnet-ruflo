import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOpponentSchedule, aggregatePlayerRateThroughWeek, computeDefenseAllowedPerGame,
  leagueAverageAllowedPerGame, projectPlayerStat,
} from '../src/analysis/playerProps.js';

test('buildOpponentSchedule parses SEASON_WEEK_AWAY_HOME game IDs into a symmetric week->team->opponent map', () => {
  const schedule = buildOpponentSchedule(['2024_05_ARI_SF', '2024_05_BAL_CIN', '2024_06_ARI_SEA']);
  assert.equal(schedule[5].SF, 'ARI');
  assert.equal(schedule[5].ARI, 'SF');
  assert.equal(schedule[5].CIN, 'BAL');
  assert.equal(schedule[6].ARI, 'SEA');
});

test('buildOpponentSchedule canonicalizes pbp\'s "LA" to "LAR" to match the NGS files\' team_abbr', () => {
  const schedule = buildOpponentSchedule(['2024_05_LA_SF']);
  assert.equal(schedule[5].SF, 'LAR');
  assert.equal(schedule[5].LAR, 'SF');
  assert.equal(schedule[5].LA, undefined);
});

test('buildOpponentSchedule deduplicates repeated game IDs (one per play in real pbp data)', () => {
  const schedule = buildOpponentSchedule(['2024_05_ARI_SF', '2024_05_ARI_SF', '2024_05_ARI_SF']);
  assert.equal(schedule[5].SF, 'ARI');
});

const RECEIVING_ROWS = [
  { week: 1, player_gsis_id: 'P1', team_abbr: 'SF', yards: 80 },
  { week: 2, player_gsis_id: 'P1', team_abbr: 'SF', yards: 40 },
  { week: 3, player_gsis_id: 'P1', team_abbr: 'SF', yards: 120 }, // excluded when throughWeek=2
  { week: 1, player_gsis_id: 'P2', team_abbr: 'ARI', yards: 30 },
];

test('aggregatePlayerRateThroughWeek averages only games at or before the cutoff week (no lookahead)', () => {
  const rate = aggregatePlayerRateThroughWeek(RECEIVING_ROWS, 'P1', 'yards', 2);
  assert.equal(rate.gamesPlayed, 2);
  assert.equal(rate.avgPerGame, 60); // (80+40)/2
});

test('aggregatePlayerRateThroughWeek returns null for a player with no games yet (not a fabricated zero)', () => {
  const rate = aggregatePlayerRateThroughWeek(RECEIVING_ROWS, 'NOBODY', 'yards', 2);
  assert.equal(rate, null);
});

test('computeDefenseAllowedPerGame sums same-game contributions from multiple offensive players before averaging across games', () => {
  const rows = [
    // Week 1: SF's offense (2 receivers) plays ARI's defense
    { week: 1, team_abbr: 'SF', yards: 80 },
    { week: 1, team_abbr: 'SF', yards: 40 },
    // Week 2: SF plays a different opponent (SEA)
    { week: 2, team_abbr: 'SF', yards: 60 },
  ];
  const schedule = { 1: { SF: 'ARI', ARI: 'SF' }, 2: { SF: 'SEA', SEA: 'SF' } };
  const allowed = computeDefenseAllowedPerGame(rows, 'yards', schedule, 2);
  assert.equal(allowed.ARI, 120); // 80+40 in one game, one game sample
  assert.equal(allowed.SEA, 60);
});

test('computeDefenseAllowedPerGame respects the throughWeek cutoff (no lookahead)', () => {
  const rows = [
    { week: 1, team_abbr: 'SF', yards: 100 },
    { week: 2, team_abbr: 'SF', yards: 200 }, // excluded when throughWeek=1
  ];
  const schedule = { 1: { SF: 'ARI', ARI: 'SF' }, 2: { SF: 'ARI', ARI: 'SF' } };
  const allowed = computeDefenseAllowedPerGame(rows, 'yards', schedule, 1);
  assert.equal(allowed.ARI, 100);
});

test('leagueAverageAllowedPerGame averages across every defense with data, null when there is none', () => {
  assert.equal(leagueAverageAllowedPerGame({ ARI: 100, SEA: 200 }), 150);
  assert.equal(leagueAverageAllowedPerGame({}), null);
});

test('projectPlayerStat scales the player\'s own rate by the opponent-vs-league-average ratio', () => {
  const proj = projectPlayerStat({ playerRate: { gamesPlayed: 3, avgPerGame: 60 }, opponentAllowedPerGame: 90, leagueAvgAllowedPerGame: 60 });
  assert.equal(proj.projected, 90); // 60 * (90/60) = 90 -- plays a leaky defense, projection rises
  assert.equal(proj.matchupFactor, 1.5);
});

test('projectPlayerStat falls back to the player\'s unadjusted rate when opponent-defense data is missing (no fabricated adjustment)', () => {
  const proj = projectPlayerStat({ playerRate: { gamesPlayed: 3, avgPerGame: 60 }, opponentAllowedPerGame: null, leagueAvgAllowedPerGame: null });
  assert.equal(proj.projected, 60);
  assert.equal(proj.matchupFactor, null);
});

test('projectPlayerStat returns null when the player has no rate at all (nothing to project)', () => {
  assert.equal(projectPlayerStat({ playerRate: null, opponentAllowedPerGame: 90, leagueAvgAllowedPerGame: 60 }), null);
});

test('projectPlayerStat\'s matchupWeight interpolates between the naive rate (0) and the full ratio (1, the default)', () => {
  const base = { playerRate: { gamesPlayed: 3, avgPerGame: 60 }, opponentAllowedPerGame: 90, leagueAvgAllowedPerGame: 60 }; // matchupFactor 1.5
  const full = projectPlayerStat(base);
  assert.equal(full.projected, 90); // default weight 1 -- unchanged from before matchupWeight existed

  const naive = projectPlayerStat({ ...base, matchupWeight: 0 });
  assert.equal(naive.projected, 60); // weight 0 -- ignores the matchup entirely

  const half = projectPlayerStat({ ...base, matchupWeight: 0.5 });
  assert.equal(half.projected, 75); // halfway between 60 and 90
});
