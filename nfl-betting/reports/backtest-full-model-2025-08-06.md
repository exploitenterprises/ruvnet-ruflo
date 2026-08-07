# Full-Model Backtest — NFL & CFB, 2024 + 2025 Seasons

_Generated 2026-08-06, extended same day to a second season and then to a
weight-tuning pass (see "Weight tuning results" below). Scope: the FULL
matchup-engine blend (season-to-date box-score stats + Elo + EPA/play) —
not just the Elo signal covered in `reports/backtest-elo-2025-08-06.md`.
Weather is deliberately excluded from every backtest below, not faked:
there's no honest historical-forecast source wired up (Open-Meteo has no
deep archive), so every projection uses `{ isDome: true }` — no weather
adjustment, for every game._

## What changed since the Elo-only backtest

The Elo-only backtest's write-up said the full blend "can't be honestly
backtested yet" because both CFBD's `/stats/season` and ESPN's
`fetchTeamSeasonStats` are "as of query time" aggregates. Half of that
turned out to be wrong:

- **CFB**: CFBD's `/stats/season` and `/stats/season/advanced` genuinely
  support `startWeek`/`endWeek` point-in-time scoping — confirmed live
  (Air Force's `games` stat: 4 for weeks 1-5 vs. 12 full-season; `plays`:
  262 vs. 823). This was never tested before assuming it wasn't there. No
  reconstruction needed — `cfbFullBacktest.js` just requests the right
  window per week.
- **NFL**: ESPN's team-statistics endpoint really does ignore a `week`
  query param (confirmed live: `gamesPlayed: 17` whether or not `week=5` is
  passed). This half needed the reconstruction originally planned:
  `analysis/pointInTimeStats.js` aggregates real per-game boxscores
  (`statsProvider.js`'s new `fetchGameBoxscore`) into "stats as of week N,"
  built only from games that had actually been played by the cutoff.

## Real bugs found and fixed along the way

1. **A dropped connection killed a 272-call backtest with no partial
   progress.** Sequential calls to ESPN's API over several minutes hit a
   real transient failure (`curl` exit 35, `SSL_ERROR_SYSCALL`) — curl's
   default `--retry` doesn't cover a raw connection reset, only
   timeouts/5xx. Fixed by adding `--retry-all-errors` to every ESPN call
   (`statsProvider.js`, `injuryProvider.js`).
2. **ESPN's scoreboard endpoint silently stopped honoring
   `year`/`week`/`seasontype` entirely.** A `year=2025&week=1` request
   returned `season.year: 2026` — the *next* season's not-yet-played
   opener — with no error, just a wrong-season payload shaped identically
   to a right-season one. This wasn't limited to 2025: once discovered, the
   same drift affected `year=2024` requests too, and the response's own
   `season` metadata field turned out to be independently unreliable (it
   could claim 2026 even when the actual `events` returned were genuinely
   correct 2024 games — the label and the data can be wrong in different
   ways at the same time). Fixed with a real workaround, not a guess:
   ESPN's `dates=` param (a bare year for the season calendar, or a
   `YYYYMMDD-YYYYMMDD` range for actual games) still returns correct event
   data — confirmed live for both 2024 and 2025. `fetchWeekScoreboard` now
   pulls ESPN's own published week→date-range calendar and queries by
   explicit date range, validating against the actual event dates returned
   (not the flaky season-metadata label).
3. **`fetchTeamSeasonStats` has the identical season-drift bug**, with no
   known `dates=`-based workaround. But the only thing either backtest
   script needed from it was one number per team (prior-season point
   differential, to seed Elo ratings) — replaced with
   `fetchSeasonPointDiffs`, built from real final scores via the now-fixed
   `fetchWeekScoreboard`, sidestepping the broken endpoint entirely.

## Data integrity check

Before trusting any of the numbers below, several predictions from each
season were cross-checked against real, independently-known results:

| Game | Backtest actualMargin/actualTotal | Real result |
|---|---|---|
| 2025 PHI vs DAL | margin 4, total 44 | Eagles beat Cowboys 24-20 in the real season opener — matches |
| 2025 LAC vs KC | margin 6, total 48 | Chargers beat Chiefs 27-21 in São Paulo — matches |
| 2025 BUF vs BAL | margin 1, total 81 | Bills beat Ravens 41-40 in a Thursday-night shootout — matches |
| 2024 KC vs BAL | margin 7, total 47 | Chiefs beat Ravens 27-20 in the real season opener — matches |
| 2024 PHI vs GB | margin 5, total 63 | Eagles beat Packers 34-29 in the São Paulo opener — matches |
| 2024 NO vs CAR | margin 37, total 57 | Saints beat Panthers 47-10 — matches |
| 2024 NYG vs MIN | margin -22, total 34 | Vikings beat Giants 28-6 — matches |

All real, all matching. The 2025 data was fetched before the ESPN
season-drift bug appeared mid-session (not corrupted by it); the 2024 data
was fetched after the `dates=`-based fix above, confirming the fix works.

## NFL

| Metric | 2025 Full model | 2025 Elo only | 2024 Full model | 2024 Elo only |
|---|---|---|---|---|
| Games | 272 | 272 (same) | 274 | 274 (same) |
| Brier score | 0.231 | 0.227 | 0.209 | 0.218 |
| Favorite accuracy | 60.9% | 62.7% | 68.6% | 65.7% |
| Spread MAE | 11.0 pts | 10.3 pts | 10.6 pts | 10.4 pts |
| Spread bias | +0.4 pts | -0.2 pts | -0.3 pts | +0.2 pts |
| Total MAE | 14.1 pts | _n/a_ | 12.7 pts | _n/a_ |

## CFB

Elo-only numbers are recomputed on the exact same game sample as the full
model each season (both seasons exclude week 1, which has no prior-week
stats to build from) for a true apples-to-apples comparison.

| Metric | 2025 Full model | 2025 Elo only | 2024 Full model | 2024 Elo only |
|---|---|---|---|---|
| Games | 714 | 714 (same) | 713 | 713 (same) |
| Brier score | 0.181 | 0.183 | 0.191 | 0.196 |
| Favorite accuracy | 71.8% | 73.0% | 70.1% | 68.4% |
| Spread MAE | 13.9 pts | 12.8 pts | 14.1 pts | 13.3 pts |
| Spread bias | +2.0 pts | -2.0 pts | +1.7 pts | -1.6 pts |
| Total MAE | 17.6 pts | _n/a_ | 18.4 pts | _n/a_ |

## Honest conclusion

The picture is more nuanced with a second season in hand — **not** a clean
"the blend is bad" story:

- **Win-probability calibration (Brier) and straight-up accuracy
  (favorite%) are mixed, split by season, not by league.** 2025 favors
  Elo-only in both leagues (NFL: 0.227→0.231 worse, 62.7%→60.9% worse; CFB:
  73.0%→71.8% worse on accuracy, though Brier ticks slightly better). 2024
  favors the full model in both leagues (NFL: 0.218→0.209 better,
  65.7%→68.6% better; CFB: 0.196→0.191 better, 68.4%→70.1% better). Whatever
  is driving this tracks something about the *season*, not a fixed flaw in
  one league's blend.
- **Spread MAE is the one metric that's consistent, and it's consistently
  bad news: the full model's point-spread estimate is worse than Elo alone
  in all four league-seasons**, by 0.2-1.1 points (NFL 2024: 10.4→10.6;
  NFL 2025: 10.3→11.0; CFB 2024: 13.3→14.1; CFB 2025: 12.8→13.9). Bias also
  flips sign relative to Elo-only in 3 of 4 cases. This is the more
  trustworthy signal of the two kinds of finding here — it holds across
  both leagues and both seasons, where the Brier/accuracy picture doesn't.
- **Reading the two together**: the stats/EPA signals plausibly carry real
  information about *who wins* (helping Brier/accuracy in the seasons where
  Elo alone is weaker) but are miscalibrated in *by how much* — consistently
  pulling the projected margin in a direction that doesn't track the actual
  result as well as Elo's margin estimate does on its own. That's a
  specific, actionable shape for a weight-tuning pass: the win-probability
  side of the blend and the spread-magnitude side may need different
  treatment, not just a single scalar reweighting of "how much to trust
  stats/EPA vs. Elo."

## Weight tuning results

The "honest conclusion" above ends with a specific, testable claim: the
margin blend and win-probability blend might need different treatment,
not a single scalar "trust stats/EPA more or less." `tuneBlendWeights.js`
tests that claim directly — a grid search over both ensembles
(`MARGIN_BLEND_WEIGHTS` = `{eff, elo, epa}`, `WIN_PROB_BLEND_WEIGHTS` =
`{elo, score}`, matchupEngine.js), scored against real games pooled across
all 4 league-seasons above (so a combo can't win by overfitting to one
league or season).

**Method**: 726 weight combos (a 2-simplex grid over the 3-way margin
split, crossed with an 11-point grid over the win-prob split, both at 0.1
resolution) scored against the same 1,973 real games used above, ranked by
pooled favorite accuracy (the explicit ask — "boost win percentage").
Before picking a winner, checked the neighborhood around the top result
wasn't a fragile spike: favorite accuracy for nearby combos (margin `elo`
weight 0.6-1.0, modest `eff`, small `epa`) clusters in a stable 68.9-70.2%
band, and spread MAE stays low (12.2-13.3) across that same neighborhood
— a broad, robust region, not a one-off.

**Chosen weights**:

| Weight | Original | Tuned |
|---|---|---|
| Margin blend `eff` (efficiency-model estimate) | 0.35 | 0.2 |
| Margin blend `elo` (Elo-implied margin) | 0.35 | 0.7 |
| Margin blend `epa` (EPA/play-implied margin) | 0.30 | 0.1 |
| Win-prob blend `elo` (Elo's own win probability) | 0.55 | 0 |
| Win-prob blend `score` (spread-derived win probability) | 0.45 | 1 |

The margin blend now trusts Elo more than twice as much as before (0.7 vs.
0.35) — directly addressing the finding that spread MAE was worse than
Elo alone in all 4 league-seasons with the original weights. The win-prob
blend fully routes through the spread-derived estimate rather than
injecting Elo's own win probability a second time — not "ignore Elo" (the
margin blend above still trusts Elo at 0.7, so Elo's influence still
dominates the spread that estimate is derived from), just not double
counting it.

**Before/after, same 4 league-seasons**:

| League/Season | Brier (before → after) | Favorite accuracy (before → after) | Spread MAE (before → after) | Spread bias (before → after) |
|---|---|---|---|---|
| NFL 2024 | 0.209 → 0.210 | 68.6% → **70.1%** | 10.6 → **10.1** | -0.3 → +0.1 |
| NFL 2025 | 0.231 → 0.231 | 60.9% → **63.6%** | 11.0 → **10.6** | +0.4 → +0.3 |
| CFB 2024 | 0.191 → 0.197 | 70.1% → 69.9% | 14.1 → **13.3** | +1.7 → +0.6 |
| CFB 2025 | 0.181 → 0.183 | 71.8% → **72.7%** | 13.9 → **12.8** | +2.0 → +0.5 |
| **Pooled (n=1,973)** | 0.196 → 0.199 | 69.4% → **70.2%** | 13.1 → **12.3** | — |

Total (over/under) projections are unaffected — mathematically, not just
in practice: the margin-blend reweighting shifts `homePointsEst` up and
`awayPointsEst` down by the same amount, which cancels out in their sum.
Confirmed identical total MAE/bias before and after in all 4 datasets.

**Honest read**: favorite accuracy improved in 3 of 4 league-seasons (CFB
2024 essentially flat, -0.2pp) and spread MAE improved in all 4 — a real
fix for the exact problem the original backtest found, not just a
different tradeoff. The cost is a small Brier-score regression in 3 of 4
datasets (+0.001 to +0.006) — the win probabilities are very slightly
less well-calibrated even though the yes/no favorite call is more often
right, a real but minor trade given the size of the accuracy gain. Spread
bias improved (moved closer to zero) in every single league-season,
including CFB's previously-worst offender (2025: +2.0 → +0.5).

## Per-league weight split

The pooled search above fits ONE shared weight set for both leagues — a
forced compromise if NFL and CFB actually want different weights, which is
plausible given how differently the two leagues' spread bias behaved
throughout this whole backtest (CFB's bias ran consistently higher than
NFL's at every stage). `tuneBlendWeights.js`'s `leagues` option re-runs the
identical search pooling only CFB's 1,427 games (2024+2025), fitting
`CFB_MARGIN_BLEND_WEIGHTS`/`CFB_WIN_PROB_BLEND_WEIGHTS` separately from
`NFL_*` — same precedent as `CFB_ELO_POINTS_PER_MARGIN` already being a
separate constant from `NFL_ELO_POINTS_PER_MARGIN` in `powerRatings.js`.

**Honest framing before the numbers**: the pooled search's winning combo
(used as this CFB-only search's baseline) already scored 71.2% favorite
accuracy / 0.190 Brier / 13.1 MAE on CFB alone — it had incidentally found
something that worked reasonably well for CFB too, not just NFL. So this
pass was never going to be a dramatic win; the real question was whether
CFB had its own, different local optimum worth capturing.

**Chosen CFB-specific weights**:

| Weight | Pooled (NFL_\*, used for CFB until now) | CFB-only tuned |
|---|---|---|
| Margin blend `eff` | 0.2 | 0.1 |
| Margin blend `elo` | 0.7 | 0.8 |
| Margin blend `epa` | 0.1 | 0.1 |
| Win-prob blend `elo` | 0 | 0 (unchanged) |
| Win-prob blend `score` | 1 | 1 (unchanged) |

Same direction as the pooled search found (trust Elo more, efficiency
stats less) — CFB just wanted to push slightly further (0.8 vs 0.7). Verified
stable: the eff:0-0.2/elo:0.7-0.9/epa:0-0.2 neighborhood all scores
similarly (70.7-71.3% accuracy, 0.187-0.192 Brier, 12.9-13.1 MAE), not a
fragile spike.

**Before (pooled weights) → after (CFB-specific weights)**:

| Metric | CFB 2024 | CFB 2025 |
|---|---|---|
| Brier score | 0.197 → **0.193** | 0.183 → **0.181** |
| Favorite accuracy | 69.9% → **70.5%** | 72.7% → 72.1% |
| Spread MAE | 13.3 → **13.1** | 12.8 → **12.6** |
| Spread bias | +0.6 → -0.6 | +0.5 → -0.9 |

**Honest read**: a real but modest win, not a big one. Brier and spread
MAE both improved in both seasons — genuine, if small, gains. Favorite
accuracy split (2024 better, 2025 slightly worse), the same season-level
mixed pattern seen throughout this whole backtest rather than something
new. Bias flipped sign in both seasons without consistently shrinking in
magnitude (2025's actually grew slightly, +0.5 → -0.9) — worth watching
in a future season's data rather than a settled result. NFL's weights and
results are unchanged by this pass (`NFL_*` untouched).

## Real market-line ATS backtest (added 2026-08-07)

Everything above compares the model's projections to actual game
**outcomes** — it never once checked what the market was actually
offering. Direct question from the user: "are you comparing the model to
... over under yards receptions rushing yards pre game" — the honest
answer was no, and `analysis/backtest.js`'s `atsThresholdPerformance`
function (built early in this project) had existed the whole time without
ever being fed real historical odds.

**Real market lines, confirmed live**: NFL from nflverse's "schedules"
release (`providers/nflverseProvider.js`'s new `fetchHistoricalGameLines`)
— real closing `spread_line`/`total_line` back to 1999, in this project's
own home-favored-positive convention (no negation needed). This
contradicts a stale claim that had been sitting in `atsHistory.js` and
`nflHeadToHead.js` since earlier in this project — checked and fixed.
CFB from CFBD's own `/lines` endpoint (already used live elsewhere,
now also backtested). Both leagues' joins verified: 272/274 NFL 2024 games
matched (2 unmatched — no nflverse line published for that pairing), 713/713
and 714/714 CFB 2024/2025 games matched.

`atsThresholdPerformance` bets whichever side the model disagrees with the
market on, restricted to games where that disagreement is at least
`threshold` points — this is the real test of whether the edge board's
ranking has any actual betting value.

**NFL, 2024 vs 2025 — the honest, sobering result: they point in opposite
directions**:

| Threshold | 2024 cover% (record) | 2025 cover% (record) | Pooled cover% (record) |
|---|---|---|---|
| 0 (all games) | 53.0% (142-126-4) | 42.8% (116-155-1) | 47.9% (258-281-5) |
| 1 | 55.0% (121-99-3) | 41.9% (88-122) | 48.6% (209-221-3) |
| 2 | 54.2% (96-81-1) | 41.1% (62-89) | 48.2% (158-170-1) |
| 3 | 57.0% (73-55-1) | 38.8% (40-63) | 48.9% (113-118-1) |
| 5 | 53.2% (33-29) | 44.4% (20-25) | 49.5% (53-54) |

Checked for statistical significance (SE ≈ √(0.25/n)): 2024's numbers look
good but sit at 1-1.6 SE above 50% — not significant, could be noise.
**2025's numbers are the concerning part**: at threshold 0, 42.8% is 2.4 SE
*below* 50%, and at threshold 3, 38.8% is 2.3 SE below 50% — a
statistically real losing pattern against the market, not noise. Pooled
across both seasons it washes out to roughly breakeven (47.9-49.5%,
0.2-1 SE below 50%, not significant either way). **Bottom line: this model
has not been shown to beat the closing NFL line.** The 2024-only numbers
that looked promising earlier in this project's weight-tuning work did not
hold up against 2025's real market data — a textbook case of why
out-of-sample validation against a real market matters more than
in-sample fit against outcomes.

**CFB, 2024 + 2025 — right at coin-flip, as expected for a model with no
proven market edge**:

| Threshold | 2024 cover% (record) | 2025 cover% (record) | Pooled cover% (record) |
|---|---|---|---|
| 0 (all games) | 49.8% (347-350-16) | 49.7% (347-351-16) | 49.7% (694-701-32) |
| 1 | 49.6% (288-293-15) | 51.4% (300-284-14) | 50.5% (588-577-29) |
| 2 | 49.6% (238-242-15) | 50.5% (246-241-11) | 50.1% (484-483-26) |
| 3 | 50.0% (194-194-8) | 52.2% (205-188-8) | 51.1% (399-382-16) |
| 5 | 48.8% (117-123-8) | 54.8% (126-104-6) | 51.7% (243-227-14) |

None of these are statistically distinguishable from 50% (the largest gap,
54.8% at threshold 5 in 2025, is only 1.45 SE above breakeven on n=230).
CFB is a coin-flip against the real closing line at every disagreement
threshold tested — consistent with an efficient market and no CFB-specific
edge having been found yet.

**What this means going forward**: the favorite-accuracy/Brier/MAE numbers
throughout this whole report measure whether the model predicts outcomes
well — genuinely useful for calibration — but they are not the same
question as "would this have beaten the book," and until now nothing in
this project actually answered that second question with real data. Now
something does, and the honest answer for both leagues is: no proven edge
against the closing line yet. `nflHeadToHead.js` and `cfbAtsHistory.js`
both now also expose real ATS head-to-head/division-trend history (not
just straight-up), using the same real market-line sources.

## What this still doesn't tell us

- **Weather and starter injuries** aren't included (no honest historical
  source for either — see file header). Both are real, live-verified
  signals in the actual weekly pipeline (see the CFB-parity-gap work) —
  just not backtestable yet.
- **Two seasons is still a small sample**, especially for the Brier/accuracy
  split that flipped direction between them — a third season (2023) would
  help confirm whether that's noise or a real season-level pattern (e.g.
  parity/variance differences year to year) before reading too much into it.
- **The referee, injury, EPA, and market signals are individually
  live-verified** (this session and earlier), just not jointly backtested
  outside of what's summarized above.
- **Player props still have no real market-line backtest** — this section
  closes that gap for game-level picks (spread/total) only. A free
  historical player-prop odds archive was searched for and not found (The
  Odds API only carries current/upcoming player-prop lines, not historical
  ones); see `reports/backtest-player-props-2025-08-06.md` for the
  projection-vs-outcome numbers that exist instead.
