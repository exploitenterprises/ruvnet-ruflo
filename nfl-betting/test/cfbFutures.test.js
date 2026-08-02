import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCfbFuturesValue } from '../src/analysis/cfbFutures.js';

test('findCfbFuturesValue flags a team priced well below the model probability', () => {
  const modelProbs = { 'Ohio State': 0.28, 'Notre Dame': 0.2, Indiana: 0.15, Texas: 0.15 };
  const marketOdds = [
    { team: 'Ohio State', price: 550 }, // implied ~15.4%, well under the 28% model prob
    { team: 'Notre Dame', price: 650 },
    { team: 'Indiana', price: 900 },
    { team: 'Texas', price: 900 },
  ];
  const value = findCfbFuturesValue(modelProbs, marketOdds, 'National Championship');
  const osu = value.find((v) => v.team === 'Ohio State');
  assert.ok(osu, 'expected Ohio State to be flagged as a value bet');
  assert.ok(osu.edgePct > 3);
});

test('findCfbFuturesValue does not flag a fairly priced field', () => {
  const marketOdds = [
    { team: 'Miami', price: -138 },
    { team: 'SMU', price: 700 },
  ];
  const modelProbs = { Miami: 0.58, SMU: 0.125 };
  const value = findCfbFuturesValue(modelProbs, marketOdds, 'ACC Championship');
  assert.equal(value.length, 0);
});

test('findCfbFuturesValue skips teams the model has no opinion on', () => {
  const marketOdds = [{ team: 'Unranked State', price: 5000 }];
  const value = findCfbFuturesValue({}, marketOdds, 'National Championship');
  assert.equal(value.length, 0);
});
