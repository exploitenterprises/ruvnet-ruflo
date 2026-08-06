# Elo Backtest — 2025 Season

_Generated 2026-08-06. Scope: the power-rating (Elo) signal only, backtested against
the full completed 2025 NFL and CFB seasons — see `src/analysis/backtest.js`'s file
header for why Elo specifically (it's the one signal in this project that's cleanly
reconstructable point-in-time, with zero lookahead) and what this does and doesn't
validate. This is NOT a backtest of the full matchup engine (efficiency stats + EPA +
weather + scheme, etc.) — that can't be honestly backtested yet, since both CFBD's
`/stats/season` and ESPN's `fetchTeamSeasonStats` are always "as of query time"
aggregates, not point-in-time historical snapshots._

## Real bug found and fixed along the way

Running the NFL backtest surfaced a genuine, live-pipeline-affecting bug: ESPN's API
returns **"WSH"** for Washington, while this project's team table (`data/teams.js`)
uses **"WAS"**. Left uncaught, `ratingsStore.js`'s `applyResults` computed
`undefined + number` (`NaN`) for the missing rating, corrupting **both** teams in
that game — and since the corrupted rating then feeds into every subsequent game
those teams play, `NaN` cascaded through a large share of the season (roughly half
of all predictions were `NaN` before the fix). This wasn't backtest-script-only —
the same code path runs in the live weekly pipeline (`weeklyUpdate.js`). Fixed by
normalizing ESPN's abbreviation at the source (`statsProvider.js`), plus a hard
defensive guard in `applyResults` itself so any future unknown-abbreviation case
(a relocation, an API change) fails safe — skipping one game — instead of silently
corrupting the whole league's ratings again. Regression-tested in
`test/ratingsStore.test.js` and `test/backtest.test.js`.

## NFL 2025 (272 games)

| Metric | Value | Read |
|---|---|---|
| Brier score | 0.227 | Better than the 0.25 "coin flip" baseline — real but modest skill, consistent with the NFL's tight competitive balance |
| Favorite accuracy | 62.7% | The model's implied favorite won 62.7% of the time — a plausible, real-world-consistent number for NFL favorites |
| Spread MAE | 10.3 pts | Average miss on the Elo-implied margin vs. actual |
| Spread bias | -0.2 pts | Essentially unbiased — expected, since the Elo-to-points conversion constant (`powerRatings.js`) is calibrated for the NFL specifically |

Calibration (predicted win% bucket → actual win rate):

| Bucket | n | Actual win rate |
|---|---|---|
| 20-30% | 8 | 12.5% |
| 30-40% | 20 | 35.0% |
| 40-50% | 43 | 34.9% |
| 50-60% | 109 | 56.0% |
| 60-70% | 56 | 60.7% |
| 70-80% | 26 | 73.1% |
| 80-90% | 10 | 90.0% |

Reasonably well-calibrated in the buckets with real sample size (50-90%); the thinner
buckets (20-50%, n=8-43) show more noise, as expected from small samples.

## CFB 2025 (762 games)

Uses CFBD's own `homePregameElo`/`awayPregameElo` — genuinely point-in-time as
recorded before each specific game, not an as-of-query-time snapshot (see
`cfbEloBacktest.js`).

| Metric | Value | Read |
|---|---|---|
| Brier score | 0.183 | Meaningfully better than NFL's — CFB has much larger talent gaps, so Elo has more signal to work with |
| Favorite accuracy | 73.1% | Higher than NFL's, consistent with less parity in CFB |
| Spread MAE | 12.9 pts | Larger than NFL's in absolute terms — CFB margins run higher-variance |
| Spread bias | **-2.4 pts** | A real, non-trivial bias — confirms a concern already documented in `cfbEdgeBoard.js`: the Elo-to-points conversion constant (25 Elo points per point of margin) is NFL-calibrated, not re-derived for CFB's higher-scoring, higher-variance games |

Calibration is strong across the full range (11.5% → 92.1% actual win rate tracking
the 0-10% → 90-100% buckets closely), which is the headline finding: **CFBD's Elo is
well-calibrated for win probability even though the Elo→spread point conversion
this project layers on top of it is measurably biased for CFB.** The fix is a CFB-
specific recalibration of that conversion constant — a concrete, scoped follow-up,
not a rebuild.

## What this doesn't tell us

This validates the Elo signal in isolation, not the full picture users see (spreads/
totals/edge-board gaps, which blend Elo with efficiency stats, EPA, weather, scheme,
injuries). A true full-model backtest needs point-in-time reconstruction of season
stats week-by-week (per-game boxscore aggregation instead of the "as of today"
aggregate endpoints currently used) — real, buildable, and the natural next step,
but a bigger lift than this Elo-only pass.
