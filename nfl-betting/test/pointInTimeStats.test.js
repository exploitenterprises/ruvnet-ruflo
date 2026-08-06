import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateTeamStatsThroughWeek } from '../src/analysis/pointInTimeStats.js';

function boxscore({ points, netPassingYards, rushingYards, totalOffensivePlays, thirdDownEff, fourthDownEff, sacksYardsLost, redZoneAttempts }) {
  return {
    score: points,
    stats: {
      netPassingYards: String(netPassingYards), rushingYards: String(rushingYards),
      totalOffensivePlays: String(totalOffensivePlays), thirdDownEff, fourthDownEff,
      sacksYardsLost, redZoneAttempts,
    },
  };
}

const GAMES = [
  // Week 1: KC (home) beats DEN (away) 27-10
  {
    week: 1,
    home: { abbr: 'KC', ...boxscore({ points: 27, netPassingYards: 280, rushingYards: 120, totalOffensivePlays: 65, thirdDownEff: '7-14', fourthDownEff: '1-1', sacksYardsLost: '1-6', redZoneAttempts: '2-3' }) },
    away: { abbr: 'DEN', ...boxscore({ points: 10, netPassingYards: 180, rushingYards: 60, totalOffensivePlays: 60, thirdDownEff: '3-12', fourthDownEff: '0-1', sacksYardsLost: '3-20', redZoneAttempts: '1-2' }) },
  },
  // Week 2: DAL (home) beats KC (away) 24-20 — KC's only away game
  {
    week: 2,
    home: { abbr: 'DAL', ...boxscore({ points: 24, netPassingYards: 250, rushingYards: 100, totalOffensivePlays: 62, thirdDownEff: '5-13', fourthDownEff: '1-2', sacksYardsLost: '2-14', redZoneAttempts: '2-2' }) },
    away: { abbr: 'KC', ...boxscore({ points: 20, netPassingYards: 300, rushingYards: 90, totalOffensivePlays: 68, thirdDownEff: '6-15', fourthDownEff: '0-0', sacksYardsLost: '2-12', redZoneAttempts: '1-3' }) },
  },
  // Week 3: a later game — excluded when throughWeek stops at 2
  {
    week: 3,
    home: { abbr: 'KC', ...boxscore({ points: 40, netPassingYards: 350, rushingYards: 150, totalOffensivePlays: 70, thirdDownEff: '8-14', fourthDownEff: '2-2', sacksYardsLost: '0-0', redZoneAttempts: '4-4' }) },
    away: { abbr: 'LV', ...boxscore({ points: 14, netPassingYards: 200, rushingYards: 70, totalOffensivePlays: 55, thirdDownEff: '3-11', fourthDownEff: '0-1', sacksYardsLost: '4-30', redZoneAttempts: '1-2' }) },
  },
];

test('aggregateTeamStatsThroughWeek only counts games at or before the cutoff week', () => {
  const throughWeek2 = aggregateTeamStatsThroughWeek(GAMES, 'KC', 2);
  assert.equal(throughWeek2.gamesPlayed, 2);
  const fullSeason = aggregateTeamStatsThroughWeek(GAMES, 'KC', 3);
  assert.equal(fullSeason.gamesPlayed, 3);
});

test('aggregateTeamStatsThroughWeek computes real per-game point averages, split by home/away', () => {
  const kc = aggregateTeamStatsThroughWeek(GAMES, 'KC', 2);
  assert.equal(kc.pointsForPerGame, (27 + 20) / 2);
  assert.equal(kc.pointsAgainstPerGame, (10 + 24) / 2);
  assert.equal(kc.homePointsForPerGame, 27); // only one home game so far
  assert.equal(kc.awayPointsForPerGame, 20); // only one away game so far
});

test('aggregateTeamStatsThroughWeek parses made-attempts fractions into real percentages', () => {
  const kc = aggregateTeamStatsThroughWeek(GAMES, 'KC', 2);
  // third downs: week1 7-14, week2 6-15 -> 13/29
  assert.ok(Math.abs(kc.thirdDownPct - (13 / 29) * 100) < 1e-9);
  // red zone: week1 2-3, week2 1-3 -> 3/6
  assert.ok(Math.abs(kc.redZoneTdPct - (3 / 6) * 100) < 1e-9);
});

test('aggregateTeamStatsThroughWeek reads sacks from the OPPONENT boxscore for sackRate (defense), and own boxscore for sackRateAllowed (offense)', () => {
  const kc = aggregateTeamStatsThroughWeek(GAMES, 'KC', 2);
  // KC's own sacks-allowed (offense): week1 1, week2 2 -> avg 1.5
  assert.equal(kc.sackRateAllowed, (1 + 2) / 2);
  // KC's sacks made (defense) = opponent's sacksYardsLost: week1 DEN 3, week2 DAL 2 -> avg 2.5
  assert.equal(kc.sackRate, (3 + 2) / 2);
});

test('aggregateTeamStatsThroughWeek falls back to league-average defaults for a team with zero games so far (no real-zero false signal)', () => {
  const profile = aggregateTeamStatsThroughWeek(GAMES, 'MIA', 2);
  assert.equal(profile.gamesPlayed, 0);
  assert.ok(profile.pointsForPerGame > 0);
  assert.ok(profile.sackRate > 0); // not a computed 0/0
});
