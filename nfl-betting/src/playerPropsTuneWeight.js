// Grid-searches analysis/playerProps.js's tunable weights per stat
// category, against real backtest data:
// - passYards/rushYards: matchupWeight (opponent-defense adjustment).
// - receivingYards/receptions: usageTrendWeight x windowGames (the
//   usage-trend model — targets x efficiency, with targets blended toward
//   a recent-window rate). Built after the opponent-adjustment model
//   (including a position-split variant) was grid-searched exhaustively
//   for these two categories and found nothing — see
//   reports/backtest-player-props-2025-08-06.md's "Position split" section.
//
// Fetches each season ONCE (via playerPropsBacktest.js's
// buildPlayerPropsGames), then re-scores every candidate combo against
// those same fetched games — pure computation, no network.
//
// "Win rate" here is the honest analog of the team-level backtest's
// "favorite accuracy," adapted for a continuous stat with no real market
// line to test against (see the report for why: no historical player-prop
// odds archive exists). Uses the player's own season-long baseline
// (naiveProjected, i.e. weight 0) as the reference line: did the tuned
// model's directional call (over/under that baseline) match which side
// the actual result actually landed on?

import { buildPlayerPropsGames, scoreCategoryGames, scoreUsageTrendGames } from './playerPropsBacktest.js';
import { errorStats } from './analysis/backtest.js';

function weightGrid(step = 0.05, max = 1.5) {
  const combos = [];
  for (let w = 0; w <= max + 1e-9; w += step) combos.push(Math.round(w * 100) / 100);
  return combos;
}

function directionalWinRate(predictions) {
  let wins = 0, losses = 0;
  for (const p of predictions) {
    if (p.naiveProjected == null) continue;
    if (p.projected === p.naiveProjected || p.actual === p.naiveProjected) continue;
    const called = p.projected > p.naiveProjected ? 'over' : 'under';
    const actualSide = p.actual > p.naiveProjected ? 'over' : 'under';
    if (called === actualSide) wins++; else losses++;
  }
  const total = wins + losses;
  return { n: total, wins, losses, winPct: total ? Math.round((wins / total) * 1000) / 10 : null };
}

function summarize(preds, extra) {
  return { ...extra, mae: errorStats(preds, 'projected', 'actual')?.mae ?? null, bias: errorStats(preds, 'projected', 'actual')?.bias ?? null, directional: directionalWinRate(preds) };
}

// 1D search over matchupWeight for the opponent-adjusted categories.
export async function tuneMatchupWeights({ step = 0.05, max = 1.5, categories = ['passYards', 'rushYards'], onProgress } = {}) {
  onProgress?.('fetching 2024...');
  const games2024 = await buildPlayerPropsGames(2024);
  onProgress?.('fetching 2025...');
  const games2025 = await buildPlayerPropsGames(2025);
  const grid = weightGrid(step, max);

  const results = {};
  for (const category of categories) {
    const pooledGames = [...games2024[category], ...games2025[category]];
    const scored = grid.map((matchupWeight) => summarize(scoreCategoryGames(pooledGames, matchupWeight, 0), { matchupWeight, priorGames: 0 }));
    results[category] = { scored, best: [...scored].sort((a, b) => a.mae - b.mae)[0], n: pooledGames.length };
  }
  return results;
}

// 2D search over usageTrendWeight x windowGames for the usage-trend
// categories.
export async function tuneUsageTrendWeights({
  step = 0.05, max = 1, windowGrid = [1, 2, 3, 4, 5, 6, 8],
  categories = ['receivingYards', 'receptions'], onProgress,
} = {}) {
  onProgress?.('fetching 2024...');
  const games2024 = await buildPlayerPropsGames(2024);
  onProgress?.('fetching 2025...');
  const games2025 = await buildPlayerPropsGames(2025);
  const weightPoints = weightGrid(step, max);

  const results = {};
  for (const category of categories) {
    const pooledGames = [...games2024[category], ...games2025[category]];
    const scored = [];
    // weight=0 doesn't depend on windowGames at all (recentUsageRate is
    // never computed) -- only score it once instead of once per window.
    scored.push(summarize(scoreUsageTrendGames(pooledGames, 0, windowGrid[0]), { usageTrendWeight: 0, windowGames: null }));
    for (const usageTrendWeight of weightPoints.filter((w) => w > 0)) {
      for (const windowGames of windowGrid) {
        scored.push(summarize(scoreUsageTrendGames(pooledGames, usageTrendWeight, windowGames), { usageTrendWeight, windowGames }));
      }
    }
    results[category] = { scored, best: [...scored].sort((a, b) => a.mae - b.mae)[0], n: pooledGames.length };
  }
  return results;
}
