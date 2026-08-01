import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateSeason, findFuturesValue } from '../src/analysis/futures.js';
import { TEAMS } from '../src/data/teams.js';

function seededRng(seed) {
  let s = seed;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function baseTeams(overrides = {}) {
  const teams = {};
  for (const abbr of Object.keys(TEAMS)) {
    teams[abbr] = { rating: 1500, currentWins: 0, currentLosses: 0, currentTies: 0, ...overrides[abbr] };
  }
  return teams;
}

// Full round-robin among the AFC West so the division race is actually decided by simulated games.
function afcWestRoundRobin() {
  const div = ['KC', 'DEN', 'LV', 'LAC'];
  const games = [];
  for (let i = 0; i < div.length; i++) {
    for (let j = i + 1; j < div.length; j++) {
      games.push({ home: div[i], away: div[j], neutralSite: true });
      games.push({ home: div[j], away: div[i], neutralSite: true });
    }
  }
  return games;
}

test('a much better-rated team wins its division far more often than its rivals', () => {
  const teams = baseTeams({ KC: { rating: 1800 } });
  const result = simulateSeason({ teams, remainingSchedule: afcWestRoundRobin(), iterations: 500, rng: seededRng(42) });
  assert.ok(result.KC.divisionWinPct > 0.7, `expected KC to dominate AFC West, got ${result.KC.divisionWinPct}`);
  assert.ok(result.KC.divisionWinPct > result.DEN.divisionWinPct);
  assert.ok(result.KC.divisionWinPct > result.LV.divisionWinPct);
  assert.ok(result.KC.divisionWinPct > result.LAC.divisionWinPct);
});

test('division win probabilities within a fully simulated division sum to ~1', () => {
  const teams = baseTeams();
  const result = simulateSeason({ teams, remainingSchedule: afcWestRoundRobin(), iterations: 500, rng: seededRng(7) });
  const sum = ['KC', 'DEN', 'LV', 'LAC'].reduce((acc, abbr) => acc + result[abbr].divisionWinPct, 0);
  assert.ok(Math.abs(sum - 1) < 0.05, `expected AFC West probabilities to sum to ~1, got ${sum}`);
});

test('equal ratings and equal schedule produce roughly equal division odds', () => {
  const teams = baseTeams();
  const result = simulateSeason({ teams, remainingSchedule: afcWestRoundRobin(), iterations: 4000, rng: seededRng(99) });
  for (const abbr of ['KC', 'DEN', 'LV', 'LAC']) {
    assert.ok(Math.abs(result[abbr].divisionWinPct - 0.25) < 0.08, `${abbr} expected ~25%, got ${result[abbr].divisionWinPct}`);
  }
});

test('findFuturesValue flags an underpriced favorite and removes vig correctly', () => {
  const modelProbs = { KC: 0.5, DEN: 0.2, LV: 0.15, LAC: 0.15 };
  // Market (with vig) implies KC well below the model's 50% -> should be flagged.
  const marketOdds = [
    { team: 'KC', price: 250 },  // implied ~28.6%
    { team: 'DEN', price: 400 }, // implied 20%
    { team: 'LV', price: 600 },  // implied ~14.3%
    { team: 'LAC', price: 600 },
  ];
  const value = findFuturesValue(modelProbs, marketOdds, 'AFC West');
  const kc = value.find((v) => v.team === 'KC');
  assert.ok(kc, 'expected KC to be flagged as a futures value bet');
  assert.ok(kc.edgePct > 3);
});

test('findFuturesValue does not flag a fairly priced field', () => {
  const marketOdds = [
    { team: 'KC', price: -150 },
    { team: 'DEN', price: 150 },
  ];
  const { probs } = { probs: [0.6, 0.4] };
  const modelProbs = { KC: probs[0], DEN: probs[1] };
  const value = findFuturesValue(modelProbs, marketOdds, 'test-market');
  assert.equal(value.length, 0);
});
