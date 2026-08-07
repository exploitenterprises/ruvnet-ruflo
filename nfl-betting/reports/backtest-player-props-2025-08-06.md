# Player Props Backtest — NFL 2024 + 2025

_Generated 2026-08-06. Scope: a new player-props projection model
(`analysis/playerProps.js`, `playerPropsBacktest.js`) — this project had no
props model at all before this; the existing `'prop'` category in
`picksLedger.js` was (and still is) just a manual pick-logging slot, not a
computed projection. Four categories, matching what real prop markets
actually offer: passing yards, rushing yards, receiving yards, receptions._

## The model

Same ratio-adjustment shape as the team-level model
(`matchupEngine.js`'s `unitAdjustedPoints`): a player's own trailing
per-game rate, scaled by how much the upcoming opponent's defense has
allowed in that category relative to league average.

```
projected = playerOwnRate x (opponentAllowedPerGame / leagueAvgAllowedPerGame)
```

Built entirely from data already available in this project — no new
provider needed:

- **Player's own rate & actual outcomes**: nflverse's weekly Next Gen Stats
  files (`providers/nflverseProvider.js`'s `fetchNgsPassing`/
  `fetchNgsRushing`/`fetchNgsReceiving`) — real per-game rows with a `week`
  column, already fetchable.
- **Opponent-per-week**: derived directly from play-by-play's `game_id`
  format (`SEASON_WEEK_AWAY_HOME`) — no schedule endpoint needed.
- **Defense-allowed rates**: attributes each week's offensive output to the
  defense that allowed it (via the derived schedule), summed per game (a
  defense faces multiple contributing players in one game) then averaged.

Point-in-time throughout: every week-N projection uses only games through
week N-1, both for the player's own rate and for defense-allowed rates —
same no-lookahead discipline as the team-level backtests.

## Real bugs found and fixed along the way

1. **A season-total row disguised as a game.** All three NGS files contain
   a `week: 0` row per player per season that isn't a real game — it's that
   player's full-season totals folded into the same weekly file (e.g. a
   `week: 0` row for a QB with `attempts: 504, pass_yards: 3870` — an
   entire season, not one game). Left uncaught, `week <= throughWeek`
   filtering included it in every trailing average from week 1 onward,
   producing genuinely absurd projections (one early test run projected
   235 receiving yards for a WR in a single game — the tell that led to
   this). Fixed at the source (`nflverseProvider.js` now filters `week !==
   0` out of all three NGS fetches) rather than in every consumer.
2. **A real abbreviation mismatch within nflverse's own datasets**: play-by-
   play uses `"LA"` for the Rams (`posteam`/`defteam`/`game_id`), but the
   NGS files use `"LAR"` — confirmed live, the only mismatch across all 32
   teams. Every Rams game's opponent-allowed attribution would have
   silently failed to join without this. Canonicalized in
   `playerProps.js`'s `buildOpponentSchedule`.

## Results

Eligibility filters (real usage thresholds — a QB with 2 mop-up attempts or
a WR with 0 targets isn't a meaningful test of the projection) and a
minimum of 3 games of trailing history before trusting a player's own rate.

| Category | Season | n | MAE | Bias | Mean actual | MAE as % of mean |
|---|---|---|---|---|---|---|
| Passing yards | 2024 | 385 | 63.7 | -5.3 | 234.9 | 27% |
| Passing yards | 2025 | 369 | 55.7 | -0.9 | 229.0 | 24% |
| Rushing yards | 2024 | 328 | 29.0 | +0.7 | 75.7 | 38% |
| Rushing yards | 2025 | 373 | 29.8 | -2.5 | 71.8 | 42% |
| Receiving yards | 2024 | 752 | 29.1 | -1.7 | 65.5 | 44% |
| Receiving yards | 2025 | 700 | 28.9 | +0.6 | 62.6 | 46% |
| Receptions | 2024 | 752 | 1.9 | -0.1 | 5.4 | 35% |
| Receptions | 2025 | 700 | 1.8 | +0.2 | 5.1 | 35% |

Bias is small and inconsistent in sign across categories/seasons — no
systematic directional problem. The relative error ranking (passing best,
receiving worst) matches the well-known real-world variance ordering of
these stats: passing volume is the most game-plan-driven and stable;
receiving yards are the most boom/bust (one deep completion swings a whole
game's total).

## Honest finding: the opponent-defense adjustment mostly doesn't help

Same question asked of the team-level model's added signals (EPA, stats)
back in the full-model backtest: does the extra complexity actually earn
its keep versus a simpler baseline? Compared the model above against a
naive baseline — just the player's own trailing rate, no opponent
adjustment at all:

| Category | Season | With matchup adjustment (MAE) | Naive, own-rate-only (MAE) |
|---|---|---|---|
| Passing yards | 2024 | 63.7 | **59.9** |
| Passing yards | 2025 | 55.7 | 56.3 |
| Rushing yards | 2024 | 29.0 | **27.9** |
| Rushing yards | 2025 | 29.8 | **27.9** |
| Receiving yards | 2024 | 29.1 | **27.7** |
| Receiving yards | 2025 | 28.9 | **27.1** |
| Receptions | 2024 | 1.9 | **1.8** |
| Receptions | 2025 | 1.8 | **1.7** |

**The naive baseline wins in 7 of 8 cases.** This mirrors what the
full-model backtest found at the team level (added signals hurt spread MAE
versus Elo alone) — a real, recurring pattern in this project, not a
one-off. Plausible cause: a defense's per-category allowed rate is a noisy
signal at typical in-season sample sizes (3-10 games), so the multiplicative
adjustment amplifies noise more often than it captures real defensive
strength differences. This wasn't tuned/weighted the way the team-level
blend was (no grid search here yet) — a natural next step, same playbook as
`tuneBlendWeights.js`, would be finding whether a *partial* matchup
adjustment (a blend weight between 0 and 1, not the full ratio) beats both
extremes, rather than concluding the signal is worthless outright.

## What this doesn't tell us

- **No historical market-line comparison.** The Odds API only carries
  current/upcoming player-prop lines, and this project has no historical
  player-prop odds archive — these MAE/bias numbers are projection-vs-
  real-outcome accuracy, not validated edge-finding against real
  sportsbook lines the way the team-level edge board is. Whether this
  model would actually beat the market on props is a genuinely open
  question this backtest doesn't answer.
- **No injury/role-change handling.** A player's trailing rate doesn't
  know about a new starting role, a returning-from-injury snap-count
  ramp-up, or a suspension — all real, common causes of a game deviating
  sharply from recent-average, and a likely contributor to the higher-
  variance categories' MAE.
- **Two seasons, same small-sample caveat as the team-level backtests** —
  worth a third season before trusting any specific number precisely.
