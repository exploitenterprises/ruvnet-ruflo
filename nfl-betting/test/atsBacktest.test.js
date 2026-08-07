import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachMarketLines } from '../src/atsBacktest.js';

test('attachMarketLines joins on week|homeTeam|awayTeam and leaves unmatched games null', () => {
  const predictions = [
    { week: 1, homeTeam: 'KC', awayTeam: 'BAL', projectedSpread: -2.3 },
    { week: 1, homeTeam: 'PHI', awayTeam: 'GB', projectedSpread: -0.9 },
  ];
  const marketByKey = new Map([['1|KC|BAL', { spread: 3, total: 46 }]]);
  const joined = attachMarketLines(predictions, marketByKey);
  assert.equal(joined[0].marketSpread, 3);
  assert.equal(joined[0].marketTotal, 46);
  assert.equal(joined[1].marketSpread, null);
  assert.equal(joined[1].marketTotal, null);
});

test('attachMarketLines does not mutate the original prediction objects', () => {
  const predictions = [{ week: 1, homeTeam: 'KC', awayTeam: 'BAL' }];
  const marketByKey = new Map([['1|KC|BAL', { spread: 3, total: 46 }]]);
  attachMarketLines(predictions, marketByKey);
  assert.equal(predictions[0].marketSpread, undefined);
});
