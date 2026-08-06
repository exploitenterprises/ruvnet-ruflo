import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headToHeadRecord, divisionTrend } from '../src/analysis/atsHistory.js';

test('headToHeadRecord filters to only games between the two teams, either home/away', () => {
  const games = [
    { homeTeam: 'A', awayTeam: 'B', homeScore: 24, awayScore: 17 },
    { homeTeam: 'B', awayTeam: 'A', homeScore: 20, awayScore: 27 },
    { homeTeam: 'A', awayTeam: 'C', homeScore: 30, awayScore: 10 }, // irrelevant, excluded
  ];
  const record = headToHeadRecord(games, 'A', 'B');
  assert.equal(record.gamesPlayed, 2);
  assert.equal(record.record, '2-0'); // A won both (24-17 at home, 27-20 on the road)
});

test('headToHeadRecord computes average point differential from the requested team\'s perspective', () => {
  const games = [
    { homeTeam: 'A', awayTeam: 'B', homeScore: 30, awayScore: 20 }, // A +10
    { homeTeam: 'B', awayTeam: 'A', homeScore: 24, awayScore: 20 }, // A -4
  ];
  const record = headToHeadRecord(games, 'A', 'B');
  assert.equal(record.record, '1-1');
  assert.equal(record.avgPointDiff, 3); // (10 + -4) / 2
});

test('headToHeadRecord counts ties without crashing the win/loss tally', () => {
  const games = [{ homeTeam: 'A', awayTeam: 'B', homeScore: 20, awayScore: 20 }];
  const record = headToHeadRecord(games, 'A', 'B');
  assert.equal(record.record, '0-0-1');
});

test('ATS is null when no game in the set carries spread data', () => {
  const games = [{ homeTeam: 'A', awayTeam: 'B', homeScore: 24, awayScore: 17 }];
  const record = headToHeadRecord(games, 'A', 'B');
  assert.equal(record.ats, null);
});

// homeSpread convention: positive = home favored by that many points
// (matches matchupEngine's projectedSpread / edgeBoard's market lines).
test('ATS cover math for the home team: covers, fails to cover, and pushes', () => {
  const covers = headToHeadRecord(
    [{ homeTeam: 'A', awayTeam: 'B', homeScore: 30, awayScore: 20, homeSpread: 5 }], 'A', 'B'
  ); // home favored by 5, won by 10 -> covered
  assert.equal(covers.ats.record, '1-0');

  const failsToCover = headToHeadRecord(
    [{ homeTeam: 'A', awayTeam: 'B', homeScore: 23, awayScore: 20, homeSpread: 5 }], 'A', 'B'
  ); // home favored by 5, won by only 3 -> did not cover
  assert.equal(failsToCover.ats.record, '0-1');

  const push = headToHeadRecord(
    [{ homeTeam: 'A', awayTeam: 'B', homeScore: 25, awayScore: 20, homeSpread: 5 }], 'A', 'B'
  ); // home favored by 5, won by exactly 5 -> push
  assert.equal(push.ats.record, '0-0-1');
});

test('ATS cover math for the away team (mirror image of the home team\'s)', () => {
  // home favored by 5 (homeSpread=5), away loses by only 2 -> away covers (got more points than needed)
  const awayCovers = headToHeadRecord(
    [{ homeTeam: 'A', awayTeam: 'B', homeScore: 22, awayScore: 20, homeSpread: 5 }], 'B', 'A'
  );
  assert.equal(awayCovers.ats.record, '1-0');

  // home favored by 5, away loses by 10 -> away did not cover
  const awayFails = headToHeadRecord(
    [{ homeTeam: 'A', awayTeam: 'B', homeScore: 30, awayScore: 20, homeSpread: 5 }], 'B', 'A'
  );
  assert.equal(awayFails.ats.record, '0-1');

  // away is actually favored (homeSpread negative) and wins outright -> away covers
  const dogWinsOutright = headToHeadRecord(
    [{ homeTeam: 'A', awayTeam: 'B', homeScore: 17, awayScore: 24, homeSpread: -3 }], 'B', 'A'
  );
  assert.equal(dogWinsOutright.ats.record, '1-0');
});

test('ATS coverPct excludes pushes from the denominator (standard handicapping convention)', () => {
  const games = [
    { homeTeam: 'A', awayTeam: 'B', homeScore: 30, awayScore: 20, homeSpread: 5 }, // covers
    { homeTeam: 'A', awayTeam: 'B', homeScore: 25, awayScore: 20, homeSpread: 5 }, // push
    { homeTeam: 'B', awayTeam: 'A', homeScore: 30, awayScore: 20, homeSpread: 5 }, // A away, loses by 10, homeSpread=5 favors B by 5 -> A doesn't cover
  ];
  const record = headToHeadRecord(games, 'A', 'B');
  assert.equal(record.ats.record, '1-1-1');
  assert.equal(record.ats.coverPct, 50); // 1 win / (1 win + 1 loss), push excluded
  assert.equal(record.ats.gamesWithSpreadData, 3);
});

test('divisionTrend aggregates every game a team played against a given opponent set', () => {
  const games = [
    { homeTeam: 'A', awayTeam: 'B', homeScore: 24, awayScore: 17 },
    { homeTeam: 'C', awayTeam: 'A', homeScore: 14, awayScore: 21 },
    { homeTeam: 'A', awayTeam: 'D', homeScore: 10, awayScore: 30 }, // D not in division, excluded
  ];
  const trend = divisionTrend(games, 'A', ['B', 'C']);
  assert.equal(trend.gamesPlayed, 2);
  assert.equal(trend.record, '2-0');
});

test('games with a missing score are skipped rather than crashing the tally', () => {
  const games = [{ homeTeam: 'A', awayTeam: 'B', homeScore: null, awayScore: null }];
  const record = headToHeadRecord(games, 'A', 'B');
  assert.equal(record.gamesPlayed, 0);
  assert.equal(record.record, '0-0');
});
