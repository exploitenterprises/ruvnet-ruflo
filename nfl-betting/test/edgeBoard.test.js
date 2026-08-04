import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEdgeBoard, nflMarketLine, cfbMarketLine } from '../src/analysis/edgeBoard.js';

function proj({ home, away, projectedSpread, projectedTotal }) {
  return { home, away, projectedSpread, projectedTotal };
}

test('buildEdgeBoard computes both gaps and sorts descending by the larger one', () => {
  const projections = [
    proj({ home: 'A', away: 'B', projectedSpread: 3, projectedTotal: 45 }), // small gap
    proj({ home: 'C', away: 'D', projectedSpread: 10, projectedTotal: 44 }), // big spread gap
    proj({ home: 'E', away: 'F', projectedSpread: 1, projectedTotal: 60 }), // big total gap
  ];
  const marketLinesByGame = {
    'B@A': { spread: 2.5, total: 44.5 },
    'D@C': { spread: 2, total: 44 }, // spreadGap = 8
    'F@E': { spread: 1, total: 47 }, // totalGap = 13
  };
  const board = buildEdgeBoard(projections, marketLinesByGame);
  assert.equal(board.length, 3);
  assert.equal(board[0].game, 'F@E'); // biggest gap (13, total)
  assert.equal(board[0].gapMarket, 'total');
  assert.equal(board[1].game, 'D@C'); // next (8, spread)
  assert.equal(board[1].gapMarket, 'spread');
  assert.equal(board[2].game, 'B@A'); // smallest
});

test('buildEdgeBoard excludes games with no market line at all', () => {
  const projections = [proj({ home: 'A', away: 'B', projectedSpread: 3, projectedTotal: 45 })];
  assert.equal(buildEdgeBoard(projections, {}).length, 0);
});

test('buildEdgeBoard handles a game with only one of spread/total quoted', () => {
  const projections = [proj({ home: 'A', away: 'B', projectedSpread: 3, projectedTotal: 45 })];
  const board = buildEdgeBoard(projections, { 'B@A': { spread: 1, total: null } });
  assert.equal(board[0].spreadGap, 2);
  assert.equal(board[0].totalGap, null);
  assert.equal(board[0].gapMarket, 'spread');
});

test('nflMarketLine takes the median home spread and median over total across books', () => {
  const lines = [
    { market: 'spread', side: 'home', points: -3 },
    { market: 'spread', side: 'home', points: -3.5 },
    { market: 'spread', side: 'away', points: 3 }, // ignored — wrong side
    { market: 'total', side: 'over', points: 44.5 },
    { market: 'total', side: 'over', points: 45 },
    { market: 'moneyline', side: 'home', points: null }, // ignored — wrong market
  ];
  const line = nflMarketLine(lines);
  assert.equal(line.spread, -3.25);
  assert.equal(line.total, 44.75);
});

test('nflMarketLine returns nulls when a market has no quotes', () => {
  assert.deepEqual(nflMarketLine([]), { spread: null, total: null });
});

test('cfbMarketLine negates CFBD\'s spread sign convention (home-negative) to this project\'s (home-positive)', () => {
  const record = { lines: [{ spread: -12.5, overUnder: 44.5 }, { spread: -8.5, overUnder: 44.5 }] };
  const line = cfbMarketLine(record);
  assert.equal(line.spread, 10.5); // median(-12.5,-8.5) = -10.5, negated => 10.5, home favored
  assert.equal(line.total, 44.5);
});

test('cfbMarketLine handles a missing/empty lines array without crashing', () => {
  assert.deepEqual(cfbMarketLine({ lines: [] }), { spread: null, total: null });
  assert.deepEqual(cfbMarketLine({}), { spread: null, total: null });
});
