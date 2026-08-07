// Grid-searches analysis/playerProps.js's matchupWeight (the blend between
// a naive own-rate-only projection and the full opponent-adjusted ratio)
// per stat category, against real backtest data. See
// reports/backtest-player-props-2025-08-06.md for why this exists: the
// full ratio (the only option before matchupWeight existed) lost to the
// naive baseline on MAE in 7 of 8 category/season combos — a real,
// measured overcorrection, not a guess that weight 1 was wrong.
//
// Fetches each season ONCE (via playerPropsBacktest.js's
// buildPlayerPropsGames), then re-scores every candidate weight against
// those same fetched games — pure computation, no network.
//
// "Win rate" here is the honest analog of the team-level backtest's
// "favorite accuracy," adapted for a continuous stat with no real market
// line to test against (see the report for why: no historical player-prop
// odds archive exists). Uses the player's own trailing average (the
// matchupWeight=0 projection) as the reference line: did the tuned model's
// directional call (over/under that baseline) match which side the actual
// result actually landed on? This is a real, non-circular, computable
// question — not a fabricated substitute for a true beat-the-book rate,
// which this backtest cannot answer without real historical prop lines.

import { buildPlayerPropsGames, scoreCategoryGames } from './playerPropsBacktest.js';
import { errorStats } from './analysis/backtest.js';

function weightGrid(step = 0.05, max = 1.5) {
  const combos = [];
  for (let w = 0; w <= max + 1e-9; w += step) combos.push(Math.round(w * 100) / 100);
  return combos;
}

// Directional call accuracy vs. the player's own trailing average
// (naiveProjected): "win" = the tuned model's over/under call relative to
// that baseline matches which side the actual result landed on. Excludes
// exact ties on either side (a call or an outcome exactly at the baseline
// has no direction to be right or wrong about).
function directionalWinRate(predictions) {
  let wins = 0, losses = 0;
  for (const p of predictions) {
    if (p.projected === p.naiveProjected || p.actual === p.naiveProjected) continue;
    const called = p.projected > p.naiveProjected ? 'over' : 'under';
    const actualSide = p.actual > p.naiveProjected ? 'over' : 'under';
    if (called === actualSide) wins++; else losses++;
  }
  const total = wins + losses;
  return { n: total, wins, losses, winPct: total ? Math.round((wins / total) * 1000) / 10 : null };
}

export async function tunePlayerPropsWeights({ step = 0.05, max = 1.5, onProgress } = {}) {
  onProgress?.('fetching 2024...');
  const games2024 = await buildPlayerPropsGames(2024);
  onProgress?.('fetching 2025...');
  const games2025 = await buildPlayerPropsGames(2025);

  const categories = Object.keys(games2024);
  const grid = weightGrid(step, max);
  onProgress?.(`scoring ${grid.length} weights x ${categories.length} categories...`);

  const results = {};
  for (const category of categories) {
    const pooledGames = [...games2024[category], ...games2025[category]];
    const scored = grid.map((matchupWeight) => {
      const preds = scoreCategoryGames(pooledGames, matchupWeight);
      return {
        matchupWeight,
        mae: errorStats(preds, 'projected', 'actual')?.mae ?? null,
        bias: errorStats(preds, 'projected', 'actual')?.bias ?? null,
        directional: directionalWinRate(preds),
      };
    });
    const best = [...scored].sort((a, b) => a.mae - b.mae)[0];
    results[category] = { scored, best, n: pooledGames.length };
  }
  return results;
}
