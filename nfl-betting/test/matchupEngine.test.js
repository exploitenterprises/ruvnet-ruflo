import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectGame } from '../src/analysis/matchupEngine.js';
import { computeLeagueAverages } from '../src/analysis/leagueAverages.js';

function makeStats(overrides = {}) {
  return {
    pointsForPerGame: 23, pointsAgainstPerGame: 21,
    homePointsForPerGame: 24, homePointsAgainstPerGame: 20,
    awayPointsForPerGame: 22, awayPointsAgainstPerGame: 22,
    passYardsPerGame: 240, rushYardsPerGame: 110,
    yardsPerPlay: 5.5, playsPerGame: 64,
    thirdDownPct: 40, redZoneTdPct: 58,
    sackRate: 6, sackRateAllowed: 6,
    fourthDownAttemptRate: 1.5,
    ...overrides,
  };
}

const leagueAvg = computeLeagueAverages([makeStats(), makeStats(), makeStats()]);

test('projectGame returns a coherent projection shape', () => {
  const proj = projectGame({
    home: { abbr: 'KC', stats: makeStats(), rating: 1550 },
    away: { abbr: 'DEN', stats: makeStats(), rating: 1500 },
    leagueAvg,
    weather: { isDome: true },
  });
  assert.equal(proj.home, 'KC');
  assert.equal(proj.away, 'DEN');
  assert.ok(proj.projectedHomeScore > 0);
  assert.ok(proj.projectedAwayScore > 0);
  assert.ok(proj.homeWinProb > 0 && proj.homeWinProb < 1);
  assert.ok(Math.abs(proj.homeWinProb + proj.awayWinProb - 1) < 1e-9);
  assert.equal(proj.projectedTotal, Math.round((proj.projectedHomeScore + proj.projectedAwayScore) * 10) / 10);
});

test('a materially higher-rated home team is favored', () => {
  const proj = projectGame({
    home: { abbr: 'A', stats: makeStats(), rating: 1650 },
    away: { abbr: 'B', stats: makeStats(), rating: 1400 },
    leagueAvg,
    weather: { isDome: true },
  });
  assert.ok(proj.homeWinProb > 0.7);
  assert.ok(proj.projectedSpread > 0);
});

test('bad weather lowers the projected total versus a dome with identical teams', () => {
  const domeProj = projectGame({
    home: { abbr: 'A', stats: makeStats(), rating: 1500 },
    away: { abbr: 'B', stats: makeStats(), rating: 1500 },
    leagueAvg,
    weather: { isDome: true },
  });
  const badWeatherProj = projectGame({
    home: { abbr: 'A', stats: makeStats(), rating: 1500 },
    away: { abbr: 'B', stats: makeStats(), rating: 1500 },
    leagueAvg,
    weather: { isDome: false, windMph: 25, tempF: 15, precipProbPct: 80 },
  });
  assert.ok(badWeatherProj.projectedTotal < domeProj.projectedTotal);
  assert.ok(badWeatherProj.weatherNotes.length > 0);
});

test('a dominant offense against a weak defense projects well above league average points', () => {
  const proj = projectGame({
    home: { abbr: 'A', stats: makeStats({ pointsForPerGame: 32, homePointsForPerGame: 33 }), rating: 1500 },
    away: { abbr: 'B', stats: makeStats({ pointsAgainstPerGame: 30, awayPointsAgainstPerGame: 31 }), rating: 1500 },
    leagueAvg,
    weather: { isDome: true },
  });
  assert.ok(proj.projectedHomeScore > leagueAvg.pointsPerGame);
});
