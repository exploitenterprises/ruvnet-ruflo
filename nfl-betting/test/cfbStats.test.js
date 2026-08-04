import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupStatsByTeam, computeTeamPointsSplits, mapCfbdStatsToModel } from '../src/analysis/cfbStats.js';

test('groupStatsByTeam collapses flat {team, statName, statValue} rows into a per-team map', () => {
  const rows = [
    { team: 'Georgia', statName: 'games', statValue: 14 },
    { team: 'Georgia', statName: 'sacks', statValue: 19 },
    { team: 'Alabama', statName: 'games', statValue: 13 },
  ];
  const byTeam = groupStatsByTeam(rows);
  assert.deepEqual(byTeam.Georgia, { games: 14, sacks: 19 });
  assert.deepEqual(byTeam.Alabama, { games: 13 });
});

const GAMES = [
  { week: 1, completed: true, homeTeam: 'Georgia', awayTeam: 'Alabama', homePoints: 30, awayPoints: 20 },
  { week: 2, completed: true, homeTeam: 'Auburn', awayTeam: 'Georgia', homePoints: 10, awayPoints: 35 },
  { week: 3, completed: false, homeTeam: 'Georgia', awayTeam: 'Florida', homePoints: null, awayPoints: null }, // not yet played, excluded
  { week: 10, completed: true, homeTeam: 'Georgia', awayTeam: 'Vanderbilt', homePoints: 50, awayPoints: 3 }, // later in the season — excluded by throughWeek
];

test('computeTeamPointsSplits only counts completed games, split by home/away', () => {
  const splits = computeTeamPointsSplits(GAMES, 'Georgia', { throughWeek: 2 });
  assert.equal(splits.homeFor, 30);
  assert.equal(splits.homeAgainst, 20);
  assert.equal(splits.awayFor, 35);
  assert.equal(splits.awayAgainst, 10);
  assert.equal(splits.overallFor, 32.5); // (30+35)/2
  assert.equal(splits.overallAgainst, 15); // (20+10)/2
});

test('computeTeamPointsSplits returns nulls for a team with no completed games', () => {
  const splits = computeTeamPointsSplits(GAMES, 'Florida');
  assert.equal(splits.homeFor, null);
  assert.equal(splits.overallFor, null);
});

test('computeTeamPointsSplits with throughWeek excludes later-season games (no lookahead for historical backtests)', () => {
  const full = computeTeamPointsSplits(GAMES, 'Georgia');
  assert.equal(full.overallFor, (30 + 35 + 50) / 3); // includes the week-10 blowout
  const scoped = computeTeamPointsSplits(GAMES, 'Georgia', { throughWeek: 2 });
  assert.equal(scoped.overallFor, 32.5); // (30+35)/2, week 10 excluded
});

test('mapCfbdStatsToModel returns an all-fallback profile for a team with 0 games (no real-zero false signal)', () => {
  const profile = mapCfbdStatsToModel('New Team', { games: 0 }, {});
  assert.equal(profile.gamesPlayed, 0);
  assert.ok(profile.pointsForPerGame > 0);
  assert.ok(profile.sackRate > 0); // not a computed 0/0
});

test('mapCfbdStatsToModel maps real stat rows + points splits into matchupEngine\'s expected shape', () => {
  const statMap = {
    games: 14, netPassingYards: 3083, rushingYards: 2553, totalYards: 5636,
    passAttempts: 417, rushingAttempts: 576, sacks: 19, sacksOpponent: 18,
    thirdDowns: 182, thirdDownConversions: 79, fourthDowns: 20,
  };
  const pointsSplits = { homeFor: 34, homeAgainst: 15, awayFor: 30, awayAgainst: 18, overallFor: 32, overallAgainst: 16.5 };
  const profile = mapCfbdStatsToModel('Georgia', statMap, pointsSplits);
  assert.equal(profile.abbr, 'Georgia');
  assert.equal(profile.gamesPlayed, 14);
  assert.equal(profile.pointsForPerGame, 32);
  assert.equal(profile.homePointsForPerGame, 34);
  assert.ok(Math.abs(profile.passYardsPerGame - 3083 / 14) < 1e-9);
  assert.ok(Math.abs(profile.sackRate - 19 / 14) < 1e-9);
  assert.ok(Math.abs(profile.thirdDownPct - (79 / 182) * 100) < 1e-9);
  assert.equal(profile.priorSeasonPointDiffPerGame, 32 - 16.5);
});
