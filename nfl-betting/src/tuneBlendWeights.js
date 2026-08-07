// Grid-searches matchupEngine.js's two blend-weight ensembles
// (*_MARGIN_BLEND_WEIGHTS, *_WIN_PROB_BLEND_WEIGHTS) against real backtest
// data, instead of trusting the by-feel weights each signal shipped with.
// See reports/backtest-full-model-2025-08-06.md for why this exists: the
// full-model backtest found spread MAE consistently worse than Elo alone
// across all 4 league-seasons tested (NFL/CFB x 2024/2025) with the
// original weights — a real, measured miscalibration, not a guess.
//
// First pass pooled NFL+CFB together into one shared weight set
// (NFL_MARGIN_BLEND_WEIGHTS/NFL_WIN_PROB_BLEND_WEIGHTS, matchupEngine.js's
// default). Second pass runs `leagues: ['cfb']`-only to fit CFB_* instead
// — same method, matching the existing eloPointsPerMargin precedent of CFB
// having its own tuned constant rather than sharing NFL's.
//
// Fetches each league-season ONCE (via nflFullBacktest.js/cfbFullBacktest.js's
// buildXBacktestGames), then re-scores every candidate weight combo against
// those same fetched games with scoreXBacktestGames — pure computation, no
// network, so a few hundred combos across ~2000 total games takes seconds,
// not hours.
//
// Metrics are pooled across whichever league-seasons are included (weighted
// by game count) so a combo can't win by overfitting to a single season —
// the point of using both 2024 and 2025 within whichever league(s) are in
// scope for a given run.

import { buildNflBacktestGames, scoreNflBacktestGames } from './nflFullBacktest.js';
import { buildCfbBacktestGames, scoreCfbBacktestGames } from './cfbFullBacktest.js';
import { brierScore, favoriteAccuracy, spreadError } from './analysis/backtest.js';

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
// by game count (so a bigger dataset doesn't silently dominate a smaller
// one beyond its natural share — a simple concat already weights by n,
// which is the intent).
function pooledMetrics(predictionSets) {
  const pooled = predictionSets.flat();
  return {
    n: pooled.length,
    brier: brierScore(pooled),
    favoriteAccuracy: favoriteAccuracy(pooled),
    spreadMae: spreadError(pooled)?.mae ?? null,
  };
}

// `leagues`: which league(s) to pool into the search — ['nfl','cfb']
// (default, the original pooled pass) or a single-element array for a
// league-specific pass (e.g. ['cfb']).
export async function tuneWeights({ marginStep = 0.1, winProbStep = 0.1, leagues = ['nfl', 'cfb'], onProgress } = {}) {
  const datasets = [];
  if (leagues.includes('nfl')) {
    onProgress?.('fetching NFL 2024...');
    datasets.push({ label: 'NFL 2024', games: await buildNflBacktestGames(2024), score: scoreNflBacktestGames });
    onProgress?.('fetching NFL 2025...');
    datasets.push({ label: 'NFL 2025', games: await buildNflBacktestGames(2025), score: scoreNflBacktestGames });
  }
  if (leagues.includes('cfb')) {
    onProgress?.('fetching CFB 2024...');
    datasets.push({ label: 'CFB 2024', games: await buildCfbBacktestGames(2024), score: scoreCfbBacktestGames });
    onProgress?.('fetching CFB 2025...');
    datasets.push({ label: 'CFB 2025', games: await buildCfbBacktestGames(2025), score: scoreCfbBacktestGames });
  }

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

  // Baseline (currently-shipped weights) for comparison — each dataset's
  // own already-embedded league-default (NFL_* or CFB_*, from
  // buildNflBacktestGames/buildCfbBacktestGames) applies, since no
  // projectGameOpts override is passed here.
  const baselinePreds = datasets.map((ds) => ds.score(ds.games));
  const baseline = { pooled: pooledMetrics(baselinePreds) };

  return { results, baseline, datasetSizes: Object.fromEntries(datasets.map((d) => [d.label, d.games.length])) };
}
