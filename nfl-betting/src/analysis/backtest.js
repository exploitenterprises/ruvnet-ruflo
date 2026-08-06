// Backtesting metrics — pure functions that score a model's predictions
// against known outcomes, to check whether a signal is actually calibrated/
// predictive rather than just plausible-sounding. These functions score
// whatever predictions they're given; they don't know or care where the
// predictions came from.
//
// What makes a backtest honest is that the predictions were computable
// without lookahead — using only data that would genuinely have been known
// before the game. See nflEloBacktest.js / cfbEloBacktest.js for what's
// actually achievable without lookahead today: power ratings (Elo) can be
// cleanly reconstructed point-in-time for both leagues, so that's the scope
// of what gets backtested here. The full matchupEngine blend (efficiency
// stats + EPA + weather etc.) can't be, yet — CFBD's /stats/season and
// ESPN's fetchTeamSeasonStats are both "as of query time" aggregates, not
// point-in-time historical snapshots, so backtesting the full model would
// silently leak future information into the past (the same lookahead issue
// already documented and worked around in cfbEdgeBoard.js).

// Calibration: buckets predictions by predicted probability (10% bins) and
// reports the actual win rate in each — a well-calibrated model's "60-70%"
// bucket should win roughly 60-70% of the time. `predictions` is
// [{ homeWinProb, homeWon }].
export function calibrationBuckets(predictions) {
  const buckets = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0, wins: 0 }));
  for (const p of predictions) {
    // A NaN or out-of-[0,1]-range probability (upstream data issue — e.g.
    // the ratings-corruption bug this module's live backtests uncovered)
    // gets skipped rather than crashing the whole report over one bad point.
    if (!Number.isFinite(p.homeWinProb) || p.homeWinProb < 0 || p.homeWinProb > 1) continue;
    const idx = Math.min(9, Math.floor(p.homeWinProb * 10));
    buckets[idx].n += 1;
    if (p.homeWon) buckets[idx].wins += 1;
  }
  return buckets.map((b) => ({
    range: `${Math.round(b.lo * 100)}-${Math.round(b.hi * 100)}%`,
    n: b.n,
    actualWinRate: b.n ? round1((b.wins / b.n) * 100) : null,
  }));
}

// Brier score: mean squared error between predicted probability and actual
// outcome (1/0) — the standard calibration metric for probabilistic
// forecasts (weather forecasting, FiveThirtyEight-style sports models).
// Lower is better: 0 = perfect, 0.25 = no better than always guessing a
// coin flip, 1 = confidently wrong every time.
export function brierScore(predictions) {
  if (!predictions.length) return null;
  const sum = predictions.reduce((s, p) => s + (p.homeWinProb - (p.homeWon ? 1 : 0)) ** 2, 0);
  return round3(sum / predictions.length);
}

// Straight-up accuracy: how often the model's implied favorite actually
// won. A model can score fine here while being poorly calibrated on the
// actual probability — pair with brierScore/calibrationBuckets.
export function favoriteAccuracy(predictions) {
  const withFavorite = predictions.filter((p) => p.homeWinProb !== 0.5);
  if (!withFavorite.length) return null;
  const correct = withFavorite.filter((p) => (p.homeWinProb > 0.5) === p.homeWon).length;
  return round1((correct / withFavorite.length) * 100);
}

// Mean absolute error and mean signed error (bias) between projected
// spread and actual margin — both home-perspective (positive = home
// favored/won by that much, this project's convention throughout).
// `predictions` is [{ projectedSpread, actualMargin }].
export function spreadError(predictions) {
  const withData = predictions.filter((p) => p.projectedSpread != null && p.actualMargin != null);
  if (!withData.length) return null;
  const errors = withData.map((p) => p.projectedSpread - p.actualMargin);
  return {
    n: withData.length,
    mae: round1(errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length),
    bias: round1(errors.reduce((s, e) => s + e, 0) / errors.length),
  };
}

// If you only bet the games where the model disagreed with the market by
// at least `threshold` points (the same "gap" edgeBoard.js ranks by), what
// was the actual cover rate? This is the real test of whether the edge
// board's ranking has predictive value, not just plausible disagreement.
// `predictions` is [{ projectedSpread, marketSpread, actualMargin }], all
// home-perspective.
export function atsThresholdPerformance(predictions, thresholds = [0, 1, 2, 3, 5]) {
  return thresholds.map((threshold) => {
    const eligible = predictions.filter((p) =>
      p.projectedSpread != null && p.marketSpread != null && p.actualMargin != null &&
      Math.abs(p.projectedSpread - p.marketSpread) >= threshold);
    let wins = 0, losses = 0, pushes = 0;
    for (const p of eligible) {
      // Bet whichever side the model likes more than the market does.
      const betHome = p.projectedSpread > p.marketSpread;
      const coverMargin = betHome ? p.actualMargin - p.marketSpread : p.marketSpread - p.actualMargin;
      if (coverMargin > 0) wins++;
      else if (coverMargin < 0) losses++;
      else pushes++;
    }
    return {
      threshold, n: eligible.length,
      record: `${wins}-${losses}${pushes ? `-${pushes}` : ''}`,
      coverPct: wins + losses > 0 ? round1((wins / (wins + losses)) * 100) : null,
    };
  });
}

function round1(v) { return Math.round(v * 10) / 10; }
function round3(v) { return Math.round(v * 1000) / 1000; }
