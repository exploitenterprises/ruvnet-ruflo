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
strength differences.

## Weight tuning

Same playbook as `tuneBlendWeights.js`: `analysis/playerProps.js`'s
`projectPlayerStat` now takes a `matchupWeight` that blends between the
naive rate (0) and the original full ratio (1) — `playerPropsTuneWeight.js`
grid-searched it per category (0 to 1.5 in 0.05 steps) against 2024+2025
pooled, minimizing MAE.

| Category | Original weight | Tuned weight | MAE (original → tuned) |
|---|---|---|---|
| Passing yards | 1 | **0.25** | 59.8 → **57.6** |
| Rushing yards | 1 | **0.1** | 29.4 → **27.8** |
| Receiving yards | 1 | **0** | 29.0 → **27.4** |
| Receptions | 1 | **0** | 1.9 → **1.7** |

Receiving yards and receptions land on **weight 0** — the search found no
opponent-defense signal worth keeping at all for those two; the
MAE-optimal model is just the naive baseline. Passing and rushing yards
keep a small sliver of the adjustment (0.25 and 0.1), well short of the
original full ratio.

### Win percentage

There's no real market line to test a beat-the-book rate against (see
below), so "win percentage" here means something specific and honestly
weaker: using the player's own trailing average as the reference line, did
the tuned model's over/under call match the side the actual result landed
on? For receiving yards and receptions this question doesn't apply — at
weight 0 the model never calls a side, it just states the baseline.

| Category | Directional win rate | Record |
|---|---|---|
| Passing yards | 52.9% | 397-353 (n=750) |
| Rushing yards | 50.7% | 349-340 (n=689) |
| **Pooled (the only 2 categories with a call to grade)** | **51.8%** | 746-693 (n=1,439) |

**Read this honestly, not optimistically**: 51.8% is only 1.4 standard
errors above a 50/50 coin flip at this sample size — not statistically
significant at a conventional threshold. This is a real number, not a
rounding trick, but it should be read as "not clearly distinguishable from
random" rather than "a proven edge." Receiving yards and receptions have
no win-rate story at all — tuning concluded the honest model for those two
is just the player's own average, no directional signal.

## Position split (tested, didn't help)

Leading hypothesis for why receiving yards/receptions found zero signal:
`computeDefenseAllowedPerGame` lumped every receiver together into one
"yards allowed" number per defense, which would wash out a real effect —
a defense tough on WRs but leaky on TEs (or vice versa) shows up as a
misleading medium number for both. Built the fix: split the allowed-rate
calculation by receiver position (WR vs. TE — nflverse's NGS receiving
file only ever has those two positions, confirmed live, zero RB rows),
plus shrinkage toward league average (`shrinkDefenseRates`/`shrinkRate`,
regressing a defense's rate toward the mean based on its own real sample
size) to cover the smaller per-position samples splitting creates.

Grid-searched matchupWeight (0-1.5) x priorGames shrinkage strength
(0, 2, 4, 8, 16, 32 games) — 186 combos per category, pooled across
2024+2025:

| Category | Combos beating the naive baseline | Best result |
|---|---|---|
| Receiving yards | **0 of 186** | Still weight 0 (naive), MAE 27.4 |
| Receptions | **0 of 186** | Still weight 0 (naive), MAE 1.7 |

**Honest conclusion: this didn't work.** Not "we didn't search hard
enough" — the search covered every weight/shrinkage combination that could
plausibly help, and none did. Even at the smallest tested non-zero weight
(0.05), MAE was flat-to-worse and the directional win rate was
indistinguishable from (receiving yards, 50.4%) or below (receptions, 49%)
a coin flip. The position-split code stays (it's correct, tested
infrastructure, and the per-position defense-allowed data may be useful
for something else later), but it's not turned on by default — same
`matchupWeight: 0` conclusion as before the split, just tested far more
thoroughly. The likely real explanation: individual-game receiving output
is dominated by within-game variance (target distribution, game script,
one broken tackle) that a defense's season-to-date allowed rate — however
it's sliced — just doesn't explain much of, at these sample sizes.

## Usage-trend model (also tested, also didn't help)

Second, genuinely different hypothesis: instead of re-slicing the
opponent-defense signal again, built a usage-trend model —
`projectFromUsageTrend` in `analysis/playerProps.js` — that drops the
opponent adjustment entirely and instead decomposes the projection into
targets (usage) x efficiency (yards-per-target or catch-rate), blending
season-long target volume toward a shorter recent-window rate
(`usageTrendWeight`, `windowGames`) to try to catch a real role change —
a hot streak earning more snaps, a role shift after an injury elsewhere on
the offense — that a flat season average can't see. At weight 0 this is
algebraically identical to the plain season average (verified with a unit
test), so it's a strict test of "does recent usage add anything," not a
different baseline.

Grid-searched usageTrendWeight (0-1) x windowGames (1, 2, 3, 4, 5, 6, 8
games) — 141 combos per category, pooled across 2024+2025:

| Category | Combos beating the naive baseline | Best result |
|---|---|---|
| Receiving yards | **0 of 141** | Still weight 0 (naive), MAE 27.4 |
| Receptions | **0 of 141** | Still weight 0 (naive), MAE 1.7 |

Same clean result as the position split: no MAE improvement anywhere in
the grid. There's a faint directional hint in one slice (receptions at
weight 0.45/window 5 games: 53.2% win rate, n=628) — reported for
completeness, but at 1.6 standard errors above a coin flip it's not
meaningfully different from the passing-yards win rate already reported
above, and picking that one slice out of 141 tested combos rather than
sticking with the same MAE-first criterion used everywhere else in this
project would be cherry-picking, not a finding.

**Honest bottom line after two independent negative results**: neither
"who's the opponent" nor "is usage trending" explains individual-game
receiving output beyond the player's own season-long average, at least at
the sample sizes two NFL seasons provide. Both are real, legitimate
hypotheses that got a fair, thorough test — this isn't "we didn't try hard
enough," it's a genuine finding about where the accessible signal runs
out for these two categories with this data. `DEFAULT_USAGE_TREND_WEIGHTS`
stays at 0 for both, same as `DEFAULT_MATCHUP_WEIGHTS` — receiving
yards/receptions projections are, honestly, just the player's own recent
average, and that's the best this project's data can currently do for
them.

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
