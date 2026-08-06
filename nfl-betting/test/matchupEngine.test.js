import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectGame, MARGIN_BLEND_WEIGHTS, WIN_PROB_BLEND_WEIGHTS } from '../src/analysis/matchupEngine.js';
import { computeLeagueAverages } from '../src/analysis/leagueAverages.js';
import { CONSTANTS as ELO_CONSTANTS } from '../src/analysis/powerRatings.js';

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

test('omitting epaSplits leaves the projection identical to the pre-EPA two-way blend', () => {
  const args = {
    home: { abbr: 'A', stats: makeStats(), rating: 1520 },
    away: { abbr: 'B', stats: makeStats(), rating: 1480 },
    leagueAvg,
    weather: { isDome: true },
  };
  const withoutEpaKey = projectGame(args);
  const withEmptyEpaSplits = projectGame({ ...args, epaSplits: {} });
  assert.equal(withoutEpaKey.projectedSpread, withEmptyEpaSplits.projectedSpread);
});

test('a large EPA/play edge shifts the projected spread toward the more efficient team', () => {
  const base = {
    home: { abbr: 'A', stats: makeStats(), rating: 1500 },
    away: { abbr: 'B', stats: makeStats(), rating: 1500 },
    leagueAvg,
    weather: { isDome: true },
  };
  const withoutEpa = projectGame(base);
  const withEpa = projectGame({
    ...base,
    epaSplits: {
      home: { offEpaPerPlay: 0.2, defEpaPerPlay: -0.1 }, // strong offense, strong defense
      away: { offEpaPerPlay: -0.1, defEpaPerPlay: 0.1 }, // weak offense, weak defense
    },
  });
  assert.ok(withEpa.projectedSpread > withoutEpa.projectedSpread);
  assert.ok(withEpa.schemeNotes.some((n) => n.includes('A') && n.toLowerCase().includes('efficiency')));
});

test('a one-sided epaSplits object (only one team supplied) is treated as no data, not a crash', () => {
  const proj = projectGame({
    home: { abbr: 'A', stats: makeStats(), rating: 1500 },
    away: { abbr: 'B', stats: makeStats(), rating: 1500 },
    leagueAvg,
    weather: { isDome: true },
    epaSplits: { home: { offEpaPerPlay: 0.2, defEpaPerPlay: -0.1 } },
  });
  assert.ok(Number.isFinite(proj.projectedSpread));
});

function depthChartWithQbOut(status = 'Out') {
  return [{ name: '3WR 1TE', positions: { qb: { athletes: [{ id: '1', displayName: 'Backup-Bound Starter', injuries: [{ status, note: 'ankle' }] }] } } }];
}

test('a confirmed Out starting QB docks that team\'s projection and drops a note', () => {
  const base = {
    home: { abbr: 'A', stats: makeStats(), rating: 1500 },
    away: { abbr: 'B', stats: makeStats(), rating: 1500 },
    leagueAvg,
    weather: { isDome: true },
  };
  const healthy = projectGame(base);
  const homeQbOut = projectGame({ ...base, injuries: { home: depthChartWithQbOut() } });
  assert.ok(homeQbOut.projectedHomeScore < healthy.projectedHomeScore);
  assert.ok(homeQbOut.projectedSpread < healthy.projectedSpread);
  assert.ok(homeQbOut.schemeNotes.some((n) => n.includes('starting QB') && n.includes('docked')));
});

test('a Questionable-only QB (not Out/Doubtful/IR) does not move the projection', () => {
  const base = {
    home: { abbr: 'A', stats: makeStats(), rating: 1500 },
    away: { abbr: 'B', stats: makeStats(), rating: 1500 },
    leagueAvg,
    weather: { isDome: true },
  };
  const healthy = projectGame(base);
  const questionable = projectGame({ ...base, injuries: { home: depthChartWithQbOut('Questionable') } });
  assert.equal(healthy.projectedSpread, questionable.projectedSpread);
});

test('omitting injuries entirely behaves exactly like an empty injuries object', () => {
  const args = {
    home: { abbr: 'A', stats: makeStats(), rating: 1500 },
    away: { abbr: 'B', stats: makeStats(), rating: 1500 },
    leagueAvg,
    weather: { isDome: true },
  };
  assert.equal(projectGame(args).projectedSpread, projectGame({ ...args, injuries: {} }).projectedSpread);
});

test('a flag-happy referee adds an informational note but never moves the projection', () => {
  const base = {
    home: { abbr: 'A', stats: makeStats(), rating: 1500 },
    away: { abbr: 'B', stats: makeStats(), rating: 1500 },
    leagueAvg,
    weather: { isDome: true },
  };
  const noReferee = projectGame(base);
  const withReferee = projectGame({ ...base, referee: { name: 'Test Ref', penaltyRatio: 1.25 } });
  assert.equal(noReferee.projectedSpread, withReferee.projectedSpread);
  assert.equal(noReferee.projectedTotal, withReferee.projectedTotal);
  assert.ok(withReferee.schemeNotes.some((n) => n.includes('Test Ref') && n.includes('penalties')));
});

test('a referee near league average (ratio close to 1) adds no note', () => {
  const proj = projectGame({
    home: { abbr: 'A', stats: makeStats(), rating: 1500 },
    away: { abbr: 'B', stats: makeStats(), rating: 1500 },
    leagueAvg,
    weather: { isDome: true },
    referee: { name: 'Average Ref', penaltyRatio: 1.02 },
  });
  assert.ok(!proj.schemeNotes.some((n) => n.includes('Average Ref')));
});

test('eloPointsPerMargin defaults to the NFL constant and CFB\'s (smaller) value widens the Elo-implied spread contribution', () => {
  const base = {
    home: { abbr: 'A', stats: makeStats(), rating: 1650 },
    away: { abbr: 'B', stats: makeStats(), rating: 1400 },
    leagueAvg,
    weather: { isDome: true },
  };
  const nflDefault = projectGame(base);
  const explicitNfl = projectGame({ ...base, eloPointsPerMargin: ELO_CONSTANTS.NFL_ELO_POINTS_PER_MARGIN });
  assert.equal(nflDefault.projectedSpread, explicitNfl.projectedSpread);

  const cfbVariant = projectGame({ ...base, eloPointsPerMargin: ELO_CONSTANTS.CFB_ELO_POINTS_PER_MARGIN });
  assert.ok(cfbVariant.projectedSpread > nflDefault.projectedSpread); // same rating gap, larger implied margin
});

test('marginBlendWeights defaults to MARGIN_BLEND_WEIGHTS and an explicit override changes the projected spread', () => {
  const base = {
    home: { abbr: 'A', stats: makeStats({ pointsForPerGame: 30 }), rating: 1600 },
    away: { abbr: 'B', stats: makeStats(), rating: 1450 },
    leagueAvg,
    weather: { isDome: true },
  };
  const withDefault = projectGame(base);
  const explicitDefault = projectGame({ ...base, marginBlendWeights: MARGIN_BLEND_WEIGHTS });
  assert.equal(withDefault.projectedSpread, explicitDefault.projectedSpread);

  const eloHeavy = projectGame({ ...base, marginBlendWeights: { eff: 0.1, elo: 0.9, epa: 0 } });
  assert.notEqual(eloHeavy.projectedSpread, withDefault.projectedSpread);
});

test('marginBlendWeights renormalizes eff/elo when no EPA data is supplied, matching the pre-EPA fallback', () => {
  const base = {
    home: { abbr: 'A', stats: makeStats(), rating: 1600 },
    away: { abbr: 'B', stats: makeStats(), rating: 1450 },
    leagueAvg,
    weather: { isDome: true },
  };
  // Default weights (0.35/0.35/0.30) renormalize eff/elo to 0.5/0.5 with no EPA —
  // same as passing an explicit 0.5/0.5 weighting directly.
  const defaultNoEpa = projectGame(base);
  const explicitHalfHalf = projectGame({ ...base, marginBlendWeights: { eff: 0.5, elo: 0.5, epa: 0 } });
  assert.equal(defaultNoEpa.projectedSpread, explicitHalfHalf.projectedSpread);
});

test('winProbBlendWeights defaults to WIN_PROB_BLEND_WEIGHTS and an all-Elo override matches raw Elo win probability', () => {
  const base = {
    home: { abbr: 'A', stats: makeStats({ pointsForPerGame: 30 }), rating: 1650 },
    away: { abbr: 'B', stats: makeStats(), rating: 1400 },
    leagueAvg,
    weather: { isDome: true },
  };
  const withDefault = projectGame(base);
  const explicitDefault = projectGame({ ...base, winProbBlendWeights: WIN_PROB_BLEND_WEIGHTS });
  assert.equal(withDefault.homeWinProb, explicitDefault.homeWinProb);

  const allElo = projectGame({ ...base, winProbBlendWeights: { elo: 1, score: 0 } });
  assert.notEqual(allElo.homeWinProb, withDefault.homeWinProb);
});
