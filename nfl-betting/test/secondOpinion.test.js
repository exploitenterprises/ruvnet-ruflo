import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSecondOpinionPrompt, parseSecondOpinionResponse } from '../src/analysis/secondOpinion.js';

test('buildSecondOpinionPrompt includes the matchup, our pick, and our reasoning', () => {
  const messages = buildSecondOpinionPrompt({
    home: 'KC', away: 'BUF', market: 'spread', ourPick: 'KC -2.5', ourReasoning: 'Home field plus better roster.',
    projectedSpread: 3.1, projectedTotal: 47.5, homeWinProb: 0.58,
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.match(messages[1].content, /BUF @ KC/);
  assert.match(messages[1].content, /KC -2.5/);
  assert.match(messages[1].content, /Home field plus better roster\./);
  assert.match(messages[1].content, /3\.1/);
});

test('buildSecondOpinionPrompt omits optional projection fields that are not supplied', () => {
  const messages = buildSecondOpinionPrompt({ home: 'KC', away: 'BUF', market: 'spread', ourPick: 'KC -2.5', ourReasoning: 'x' });
  assert.doesNotMatch(messages[1].content, /projected spread/i);
  assert.doesNotMatch(messages[1].content, /projected total/i);
});

test('parseSecondOpinionResponse parses clean JSON', () => {
  const result = parseSecondOpinionResponse('{"pick":"KC -2.5","confidence":4,"agrees":true,"reasoning":"Solid roster edge."}');
  assert.equal(result.ok, true);
  assert.equal(result.pick, 'KC -2.5');
  assert.equal(result.confidence, 4);
  assert.equal(result.agrees, true);
});

test('parseSecondOpinionResponse strips a markdown code fence before parsing', () => {
  const raw = '```json\n{"pick":"BUF +2.5","confidence":3,"agrees":false,"reasoning":"Weather favors the dog."}\n```';
  const result = parseSecondOpinionResponse(raw);
  assert.equal(result.ok, true);
  assert.equal(result.pick, 'BUF +2.5');
  assert.equal(result.agrees, false);
});

test('parseSecondOpinionResponse clamps out-of-range confidence into 1-5', () => {
  const result = parseSecondOpinionResponse('{"pick":"x","confidence":9,"agrees":true,"reasoning":"y"}');
  assert.equal(result.confidence, 5);
});

test('parseSecondOpinionResponse returns ok:false on unparseable output instead of throwing', () => {
  const result = parseSecondOpinionResponse('Sure, I think KC covers.');
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('parseSecondOpinionResponse returns ok:false when required fields are missing', () => {
  const result = parseSecondOpinionResponse('{"pick":"KC -2.5"}');
  assert.equal(result.ok, false);
});
