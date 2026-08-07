// The real market-line backtest that was missing: joins the already-tuned
// full-model predictions (nflFullBacktest.js / cfbFullBacktest.js) to REAL
// historical closing lines, then runs analysis/backtest.js's
// atsThresholdPerformance — a function that existed since early in this
// project but had never actually been fed real market data. Every backtest
// before this one (Elo-only, full-model, weight tuning) compared
// projections to actual game OUTCOMES, never to what the market was
// actually offering — a real gap, not a rounding error, in what "backtest"
// meant in this project until now.
//
// NFL: nflverse's "schedules" release (providers/nflverseProvider.js's
// fetchHistoricalGameLines) — real closing spread_line/total_line back to
// 1999, previously undiscovered (the earlier investigation in
// analysis/atsHistory.js checked ESPN's boxscore endpoint and The Odds
// API's paid historical-odds tier, both dead ends, but never checked
// nflverse's own schedules file, which was already being used elsewhere in
// this project for NGS/pbp data).
// CFB: CFBD's own /lines endpoint (already used live in cfbEdgeBoard.js,
// and already proven real by cfbAtsHistory.js) — one call per season
// returns every game's lines from multiple real books.

import { backtestNflFullModel } from './nflFullBacktest.js';
import { backtestCfbFullModel } from './cfbFullBacktest.js';
import { fetchHistoricalGameLines } from './providers/nflverseProvider.js';
import { cfbMarketLine } from './analysis/edgeBoard.js';

export function attachMarketLines(predictions, marketByKey) {
  return predictions.map((p) => {
    const market = marketByKey.get(`${p.week}|${p.homeTeam}|${p.awayTeam}`);
    return { ...p, marketSpread: market?.spread ?? null, marketTotal: market?.total ?? null };
  });
}

export async function backtestNflAts(season, opts = {}) {
  const [predictions, marketLines] = await Promise.all([
    backtestNflFullModel(season, opts),
    fetchHistoricalGameLines(season),
  ]);
  const marketByKey = new Map(marketLines.map((l) => [`${l.week}|${l.homeTeam}|${l.awayTeam}`, { spread: l.spread, total: l.total }]));
  return attachMarketLines(predictions, marketByKey);
}

export async function backtestCfbAts(season, opts = {}) {
  const cfbdProvider = await import('./providers/cfbdProvider.js');
  const [predictions, lineRecords] = await Promise.all([
    backtestCfbFullModel(season, opts),
    cfbdProvider.fetchLines(season),
  ]);
  const marketByKey = new Map();
  for (const record of lineRecords) {
    if (record.week == null) continue; // defensive -- CFBD's /lines rows always carry week live, confirmed, but don't trust silently
    marketByKey.set(`${record.week}|${record.homeTeam}|${record.awayTeam}`, cfbMarketLine(record));
  }
  return attachMarketLines(predictions, marketByKey);
}
