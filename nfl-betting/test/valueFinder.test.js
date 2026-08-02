import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findValueBets } from '../src/analysis/valueFinder.js';

function makeProjection(overrides = {}) {
  return {
    home: 'KC', away: 'DEN',
    projectedSpread: 6, projectedTotal: 45,
    homeWinProb: 0.75, awayWinProb: 0.25,
    ...overrides,
  };
}

test('flags a moneyline value bet when the book price is worse than the model probability implies', () => {
  const projection = makeProjection();
  const lines = [
    { book: 'BookA', gameId: 'g1', market: 'moneyline', side: 'home', price: 130 }, // implies ~43%, model says 75%
    { book: 'BookA', gameId: 'g1', market: 'moneyline', side: 'away', price: -150 },
  ];
  const bets = findValueBets(projection, lines);
  const mlBet = bets.find((b) => b.market === 'moneyline' && b.side === 'home');
  assert.ok(mlBet, 'expected a home moneyline value bet to be found');
  assert.ok(mlBet.edgeVsBookPct > 2.5);
  assert.ok(mlBet.expectedValuePer100 > 0);
});

test('does not flag a fairly priced moneyline market', () => {
  const projection = makeProjection({ homeWinProb: 0.524, awayWinProb: 0.476 }); // ~-110 fair
  const lines = [
    { book: 'BookA', gameId: 'g1', market: 'moneyline', side: 'home', price: -110 },
    { book: 'BookA', gameId: 'g1', market: 'moneyline', side: 'away', price: -110 },
  ];
  const bets = findValueBets(projection, lines);
  assert.equal(bets.filter((b) => b.market === 'moneyline').length, 0);
});

test('line shopping picks the best price across books for the same side', () => {
  const projection = makeProjection();
  const lines = [
    { book: 'Stingy', gameId: 'g1', market: 'moneyline', side: 'home', price: -200 },
    { book: 'Generous', gameId: 'g1', market: 'moneyline', side: 'home', price: 150 },
    { book: 'Stingy', gameId: 'g1', market: 'moneyline', side: 'away', price: -150 },
    { book: 'Generous', gameId: 'g1', market: 'moneyline', side: 'away', price: -150 },
  ];
  const bets = findValueBets(projection, lines);
  const mlBet = bets.find((b) => b.market === 'moneyline' && b.side === 'home');
  assert.equal(mlBet.book, 'Generous');
});

test('spread market: a big favorite easily covering a small number is flagged as value', () => {
  const projection = makeProjection({ projectedSpread: 10 });
  const lines = [
    { book: 'BookA', gameId: 'g1', market: 'spread', side: 'home', price: -110, points: -1 },
    { book: 'BookA', gameId: 'g1', market: 'spread', side: 'away', price: -110, points: 1 },
  ];
  const bets = findValueBets(projection, lines);
  const spreadBet = bets.find((b) => b.market === 'spread' && b.side === 'home');
  assert.ok(spreadBet);
});

test('total market: a high projected total against a low posted line is flagged on the over', () => {
  const projection = makeProjection({ projectedTotal: 58 });
  const lines = [
    { book: 'BookA', gameId: 'g1', market: 'total', side: 'over', price: -110, points: 44 },
    { book: 'BookA', gameId: 'g1', market: 'total', side: 'under', price: -110, points: 44 },
  ];
  const bets = findValueBets(projection, lines);
  const overBet = bets.find((b) => b.market === 'total' && b.side === 'over');
  assert.ok(overBet);
  assert.equal(bets.find((b) => b.side === 'under'), undefined);
});

test('results are sorted by edge vs book, best first', () => {
  const projection = makeProjection();
  const lines = [
    { book: 'A', gameId: 'g1', market: 'moneyline', side: 'home', price: 105 },
    { book: 'A', gameId: 'g1', market: 'moneyline', side: 'away', price: -140 },
    { book: 'A', gameId: 'g1', market: 'total', side: 'over', price: -110, points: 38 },
    { book: 'A', gameId: 'g1', market: 'total', side: 'under', price: -110, points: 38 },
  ];
  const bets = findValueBets(projection, lines);
  for (let i = 1; i < bets.length; i++) {
    assert.ok(bets[i - 1].edgeVsBookPct >= bets[i].edgeVsBookPct);
  }
});

test('bookComparison lists every quoted book for the winning side, sorted best-EV first', () => {
  const projection = makeProjection();
  const lines = [
    { book: 'DraftKings', gameId: 'g1', market: 'moneyline', side: 'home', price: 105 },
    { book: 'FanDuel', gameId: 'g1', market: 'moneyline', side: 'home', price: 130 },
    { book: 'BetMGM', gameId: 'g1', market: 'moneyline', side: 'home', price: 115 },
    { book: 'DraftKings', gameId: 'g1', market: 'moneyline', side: 'away', price: -150 },
  ];
  const bets = findValueBets(projection, lines);
  const mlBet = bets.find((b) => b.market === 'moneyline' && b.side === 'home');
  assert.equal(mlBet.bookComparison.length, 3);
  assert.equal(mlBet.book, 'FanDuel'); // best price (+130) among the three
  assert.equal(mlBet.bookComparison[0].book, 'FanDuel');
  for (let i = 1; i < mlBet.bookComparison.length; i++) {
    assert.ok(mlBet.bookComparison[i - 1].evPer100 >= mlBet.bookComparison[i].evPer100);
  }
});

test('the best-odds book and the best-EV book are always the same book for a fixed model probability', () => {
  const projection = makeProjection();
  const lines = [
    { book: 'DraftKings', gameId: 'g1', market: 'moneyline', side: 'home', price: 105 },
    { book: 'FanDuel', gameId: 'g1', market: 'moneyline', side: 'home', price: 130 },
    { book: 'BetRivers', gameId: 'g1', market: 'moneyline', side: 'home', price: 118 },
    { book: 'DraftKings', gameId: 'g1', market: 'moneyline', side: 'away', price: -150 },
  ];
  const bets = findValueBets(projection, lines);
  const mlBet = bets.find((b) => b.market === 'moneyline' && b.side === 'home');
  const bestByEv = mlBet.bookComparison.reduce((a, b) => (b.evPer100 > a.evPer100 ? b : a));
  assert.equal(mlBet.book, bestByEv.book);
  assert.equal(mlBet.expectedValuePer100, bestByEv.evPer100);
});
