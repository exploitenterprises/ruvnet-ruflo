import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatherAdjustment } from '../src/analysis/weatherImpact.js';

test('dome games get no weather adjustment regardless of inputs', () => {
  const wx = weatherAdjustment({ isDome: true, windMph: 40, tempF: -10, precipProbPct: 100 });
  assert.equal(wx.totalMultiplier, 1);
  assert.equal(wx.passMultiplier, 1);
  assert.equal(wx.fgMultiplier, 1);
});

test('clean outdoor weather leaves multipliers near 1', () => {
  const wx = weatherAdjustment({ isDome: false, windMph: 5, tempF: 65, precipProbPct: 5 });
  assert.equal(wx.totalMultiplier, 1);
  assert.equal(wx.passMultiplier, 1);
});

test('high wind suppresses passing and field-goal multipliers more than mild wind', () => {
  const mild = weatherAdjustment({ isDome: false, windMph: 16, tempF: 65, precipProbPct: 0 });
  const high = weatherAdjustment({ isDome: false, windMph: 25, tempF: 65, precipProbPct: 0 });
  assert.ok(high.passMultiplier < mild.passMultiplier);
  assert.ok(high.fgMultiplier < mild.fgMultiplier);
});

test('extreme cold suppresses scoring and raises turnover risk', () => {
  const wx = weatherAdjustment({ isDome: false, windMph: 5, tempF: 10, precipProbPct: 0 });
  assert.ok(wx.totalMultiplier < 1);
  assert.ok(wx.turnoverBump > 0);
});

test('heavy precipitation suppresses both passing and total, raises turnover risk', () => {
  const wx = weatherAdjustment({ isDome: false, windMph: 5, tempF: 55, precipProbPct: 80 });
  assert.ok(wx.passMultiplier < 1);
  assert.ok(wx.totalMultiplier < 1);
  assert.ok(wx.turnoverBump > 0);
});

test('multipliers never fall below the 0.75 floor even in extreme combined conditions', () => {
  const wx = weatherAdjustment({ isDome: false, windMph: 35, tempF: -5, precipProbPct: 100 });
  assert.ok(wx.totalMultiplier >= 0.75);
  assert.ok(wx.passMultiplier >= 0.75);
  assert.ok(wx.fgMultiplier >= 0.75);
});
