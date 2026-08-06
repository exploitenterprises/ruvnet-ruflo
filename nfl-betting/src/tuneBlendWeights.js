// Grid-searches matchupEngine.js's two blend-weight ensembles
// (MARGIN_BLEND_WEIGHTS, WIN_PROB_BLEND_WEIGHTS) against real backtest data,
// instead of trusting the by-feel weights each signal shipped with. See
// reports/backtest-full-model-2025-08-06.md for why this exists: the
// full-model backtest found spread MAE consistently worse than Elo alone
// across all 4 league-seasons tested (NFL/CFB x 2024/2025) with the
// original weights — a real, measured miscalibration, not a guess.
//
// Fetches each league-season ONCE (via nflFullBacktest.js/cfbFullBacktest.js's
// buildXBacktestGames), then re-scores every candidate weight combo against
// those same fetched games with scoreXBacktestGames — pure computation, no
// network, so a few hundred combos across ~2000 total games takes seconds,
// not hours.
//
// Metrics are pooled across all 4 league-seasons (weighted by game count)
// so a combo can't win by overfitting to one league or one season — the
// whole point of having two seasons and two leagues in the first place.

import { buildNflBacktestGames, scoreNflBacktestGames } from './nflFullBacktest.js';
import { buildCfbBacktestGames, scoreCfbBacktestGames } from './cfbFullBacktest.js';
import { brierScore, favoriteAccuracy, spreadError } from './analysis/backtest.js';
import { MARGIN_BLEND_WEIGHTS, WIN_PROB_BLEND_WEIGHTS } from './analysis/matchupEngine.js';

// A 2-simplex grid (eff+elo+epa=1) at `step` resolution — every way to
// split 1.0 across 3 shares in `step` increments.
function marginWeightGrid(step = 0.1) {
  const combos = [];
  for (let eff = 0; eff <= 1 + 1e-9; eff += step) {
    for (let elo = 0; elo <= 1 - eff + 1e-9; elo += step) {
      const epa = round(1 - eff - elo);
      combos.push({ eff: round(eff), elo: round(elo), epa });
    }
  }
  return combos;
}

function winProbWeightGrid(step = 0.1) {
  const combos = [];
  for (let elo = 0; elo <= 1 + 1e-9; elo += step) {
    combos.push({ elo: round(elo), score: round(1 - elo) });
  }
  return combos;
}

function round(v) { return Math.round(v * 100) / 100; }

// Pools per-league-season prediction arrays into one metric set, weighted
// by game count (so CFB's larger n doesn't silently dominate NFL, or vice
// versa — a simple concat already weights by n naturally, which is the
// intent: leagues/seasons with more games get proportionally more say).
function pooledMetrics(predictionSets) {
  const pooled = predictionSets.flat();
  return {
    n: pooled.length,
    brier: brierScore(pooled),
    favoriteAccuracy: favoriteAccuracy(pooled),
    spreadMae: spreadError(pooled)?.mae ?? null,
  };
}

export async function tuneWeights({ marginStep = 0.1, winProbStep = 0.1, onProgress } = {}) {
  onProgress?.('fetching NFL 2024...');
  const nfl2024Games = await buildNflBacktestGames(2024);
  onProgress?.('fetching NFL 2025...');
  const nfl2025Games = await buildNflBacktestGames(2025);
  onProgress?.('fetching CFB 2024...');
  const cfb2024Games = await buildCfbBacktestGames(2024);
  onProgress?.('fetching CFB 2025...');
  const cfb2025Games = await buildCfbBacktestGames(2025);

  const datasets = [
    { label: 'NFL 2024', games: nfl2024Games, score: scoreNflBacktestGames },
    { label: 'NFL 2025', games: nfl2025Games, score: scoreNflBacktestGames },
    { label: 'CFB 2024', games: cfb2024Games, score: scoreCfbBacktestGames },
    { label: 'CFB 2025', games: cfb2025Games, score: scoreCfbBacktestGames },
  ];

  const marginGrid = marginWeightGrid(marginStep);
  const winProbGrid = winProbWeightGrid(winProbStep);
  onProgress?.(`scoring ${marginGrid.length * winProbGrid.length} weight combos across ${datasets.reduce((s, d) => s + d.games.length, 0)} games...`);

  const results = [];
  for (const marginBlendWeights of marginGrid) {
    for (const winProbBlendWeights of winProbGrid) {
      const projectGameOpts = { marginBlendWeights, winProbBlendWeights };
      const perDataset = {};
      const allPreds = [];
      for (const ds of datasets) {
        const preds = ds.score(ds.games, projectGameOpts);
        perDataset[ds.label] = {
          brier: brierScore(preds), favoriteAccuracy: favoriteAccuracy(preds), spreadMae: spreadError(preds)?.mae ?? null,
        };
        allPreds.push(preds);
      }
      results.push({ marginBlendWeights, winProbBlendWeights, pooled: pooledMetrics(allPreds), perDataset });
    }
  }

  // Baseline (original, un-tuned weights) for comparison.
  const baselinePreds = datasets.map((ds) => ds.score(ds.games, { marginBlendWeights: MARGIN_BLEND_WEIGHTS, winProbBlendWeights: WIN_PROB_BLEND_WEIGHTS }));
  const baseline = { marginBlendWeights: MARGIN_BLEND_WEIGHTS, winProbBlendWeights: WIN_PROB_BLEND_WEIGHTS, pooled: pooledMetrics(baselinePreds) };

  return { results, baseline, datasetSizes: Object.fromEntries(datasets.map((d) => [d.label, d.games.length])) };
}
