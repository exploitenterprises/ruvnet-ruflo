# Full-Model Backtest — NFL & CFB, 2024 + 2025 Seasons

_Generated 2026-08-06, extended same day to a second season. Scope: the
FULL matchup-engine blend (season-to-date box-score stats + Elo + EPA/play)
— not just the Elo signal covered in `reports/backtest-elo-2025-08-06.md`.
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
