import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  seedRating, regressToMean, updateRatingsAfterGame, matchupWinProbability, winProbToSpread, CONSTANTS,
} from '../src/analysis/powerRatings.js';

test('seedRating: better point differential yields a higher rating', () => {
  const good = seedRating(10);
  const bad = seedRating(-10);
  assert.ok(good > CONSTANTS.LEAGUE_AVG_RATING);
  assert.ok(bad < CONSTANTS.LEAGUE_AVG_RATING);
  assert.ok(good > bad);
});

test('regressToMean pulls extreme ratings toward league average', () => {
  const extreme = seedRating(15);
  const regressed = regressToMean(extreme);
  assert.ok(regressed < extreme);
  assert.ok(regressed > CONSTANTS.LEAGUE_AVG_RATING);
});

test('matchupWinProbability favors the home team at equal ratings via home field edge', () => {
  const p = matchupWinProbability({ homeRating: 1500, awayRating: 1500 });
  assert.ok(p > 0.5);
});

test('matchupWinProbability is 50/50 at equal ratings on a neutral site', () => {
  const p = matchupWinProbability({ homeRating: 1500, awayRating: 1500, neutralSite: true });
  assert.ok(Math.abs(p - 0.5) < 1e-9);
});

test('updateRatingsAfterGame: winner gains rating, loser loses rating, zero-sum shift', () => {
  const before = { homeRating: 1500, awayRating: 1500 };
  const after = updateRatingsAfterGame({ ...before, homeScore: 27, awayScore: 10 });
  assert.ok(after.homeRating > before.homeRating);
  assert.ok(after.awayRating < before.awayRating);
  const shiftHome = after.homeRating - before.homeRating;
  const shiftAway = before.awayRating - after.awayRating;
  assert.ok(Math.abs(shiftHome - shiftAway) < 1e-9);
});

test('updateRatingsAfterGame: a blowout produces a bigger swing than a narrow win', () => {
  const blowout = updateRatingsAfterGame({ homeRating: 1500, awayRating: 1500, homeScore: 45, awayScore: 7 });
  const narrow = updateRatingsAfterGame({ homeRating: 1500, awayRating: 1500, homeScore: 24, awayScore: 21 });
  const blowoutShift = blowout.homeRating - 1500;
  const narrowShift = narrow.homeRating - 1500;
  assert.ok(blowoutShift > narrowShift);
});

test('winProbToSpread: favorite win prob maps to a positive point spread', () => {
  const spread = winProbToSpread(0.75);
  assert.ok(spread > 0);
  const dogSpread = winProbToSpread(0.25);
  assert.ok(dogSpread < 0);
});

test('winProbToSpread: a smaller eloPointsPerMargin produces a larger-magnitude spread from the same win prob', () => {
  const nflSpread = winProbToSpread(0.75, CONSTANTS.NFL_ELO_POINTS_PER_MARGIN);
  const cfbSpread = winProbToSpread(0.75, CONSTANTS.CFB_ELO_POINTS_PER_MARGIN);
  assert.ok(CONSTANTS.CFB_ELO_POINTS_PER_MARGIN < CONSTANTS.NFL_ELO_POINTS_PER_MARGIN);
  assert.ok(cfbSpread > nflSpread);
});

test('winProbToSpread defaults to the NFL constant when no override is given', () => {
  assert.equal(winProbToSpread(0.75), winProbToSpread(0.75, CONSTANTS.NFL_ELO_POINTS_PER_MARGIN));
});
