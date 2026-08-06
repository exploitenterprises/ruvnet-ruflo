import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTeamEpaSplits,
  leagueAverageEpaPerPlay,
  epaMatchupEdgePerPlay,
} from '../src/analysis/teamEpa.js';

const PBP_ROWS = [
  { season_type: 'REG', week: 1, posteam: 'A', defteam: 'B', play_type: 'pass', epa: 0.6, success: 1 },
  { season_type: 'REG', week: 1, posteam: 'A', defteam: 'B', play_type: 'run', epa: 0.2, success: 0 },
  { season_type: 'REG', week: 1, posteam: 'B', defteam: 'A', play_type: 'pass', epa: -0.4, success: 0 },
  { season_type: 'REG', week: 2, posteam: 'A', defteam: 'B', play_type: 'pass', epa: 1.0, success: 1 },
  // excluded: not a scrimmage play (special teams)
  { season_type: 'REG', week: 1, posteam: 'A', defteam: 'B', play_type: 'no_play', epa: 0.9, success: 1 },
  { season_type: 'REG', week: 1, posteam: 'C', defteam: 'D', play_type: 'punt', epa: -0.05, success: 0 },
  // excluded: postseason, doesn't match default seasonType filter
  { season_type: 'POST', week: 1, posteam: 'A', defteam: 'B', play_type: 'pass', epa: 5, success: 1 },
  // excluded: no epa value
  { season_type: 'REG', week: 1, posteam: 'A', defteam: 'B', play_type: 'pass', epa: null, success: null },
];

test('computeTeamEpaSplits aggregates only regular-season scrimmage plays with a real epa value', () => {
  const splits = computeTeamEpaSplits(PBP_ROWS);
  assert.ok(Math.abs(splits.A.offEpaPerPlay - 0.6) < 1e-9); // (0.6+0.2+1.0)/3
  assert.ok(Math.abs(splits.A.offSuccessRate - (2 / 3)) < 1e-9);
  assert.equal(splits.A.offPlays, 3);
  assert.ok(Math.abs(splits.A.defEpaPerPlay - (-0.4)) < 1e-9); // faced B's one pass
  assert.ok(Math.abs(splits.B.offEpaPerPlay - (-0.4)) < 1e-9);
  assert.ok(Math.abs(splits.B.defEpaPerPlay - 0.6) < 1e-9); // faced A's three plays
});

test('computeTeamEpaSplits never includes teams whose only rows are non-scrimmage plays', () => {
  const splits = computeTeamEpaSplits(PBP_ROWS);
  assert.equal(splits.C, undefined);
  assert.equal(splits.D, undefined);
});

test('computeTeamEpaSplits throughWeek scopes to a mid-season snapshot', () => {
  const splits = computeTeamEpaSplits(PBP_ROWS, { throughWeek: 1 });
  assert.ok(Math.abs(splits.A.offEpaPerPlay - 0.4) < 1e-9); // (0.6+0.2)/2, week 2 row excluded
  assert.equal(splits.A.offPlays, 2);
});

test('leagueAverageEpaPerPlay averages the given side across every team with data', () => {
  const splits = computeTeamEpaSplits(PBP_ROWS);
  assert.ok(Math.abs(leagueAverageEpaPerPlay(splits, 'off') - 0.1) < 1e-9); // (0.6 + -0.4) / 2
  assert.ok(Math.abs(leagueAverageEpaPerPlay(splits, 'def') - 0.1) < 1e-9); // (-0.4 + 0.6) / 2
});

test('leagueAverageEpaPerPlay returns null on an empty split set', () => {
  assert.equal(leagueAverageEpaPerPlay({}, 'off'), null);
});

test('epaMatchupEdgePerPlay nets home offense-vs-away-defense against away offense-vs-home-defense', () => {
  const home = { offEpaPerPlay: 0.15, defEpaPerPlay: -0.05 };
  const away = { offEpaPerPlay: 0.05, defEpaPerPlay: 0.02 };
  // home side: 0.15 - 0.02 = 0.13; away side: 0.05 - (-0.05) = 0.10; edge = 0.03
  assert.ok(Math.abs(epaMatchupEdgePerPlay(home, away) - 0.03) < 1e-9);
});

test('epaMatchupEdgePerPlay returns null when either side is missing data', () => {
  assert.equal(epaMatchupEdgePerPlay(null, { offEpaPerPlay: 0.1, defEpaPerPlay: 0 }), null);
  assert.equal(epaMatchupEdgePerPlay({ offEpaPerPlay: 0.1, defEpaPerPlay: null }, { offEpaPerPlay: 0.1, defEpaPerPlay: 0 }), null);
});
