# Full-Model Backtest — NFL & CFB 2025 Season

_Generated 2026-08-06. Scope: the FULL matchup-engine blend (season-to-date
box-score stats + Elo + EPA/play) — not just the Elo signal covered in
`reports/backtest-elo-2025-08-06.md`. Weather is deliberately excluded from
both backtests below, not faked: there's no honest historical-forecast
source wired up (Open-Meteo has no deep archive), so every projection uses
`{ isDome: true }` — no weather adjustment, for every game._

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
2. **ESPN's scoreboard endpoint silently stopped honoring `year` mid-session.**
   A `year=2025&week=1` request returned `season.year: 2026` — the *next*
   season's not-yet-played opener — with no error, just a wrong-season
   payload shaped identically to a right-season one. Confirmed real, not a
   fluke: reproduced 3x in a row, and the drift happened *between* two
   points in this same session (the full NFL backtest's data, fetched
   earlier, is genuinely real 2025 results — cross-checked against known
   scores, see below — but the same query now returns 2026 data). This
   directly blocks the live pipeline from querying the just-completed
   season right now. Fixed with a hard guard in `fetchWeekScoreboard`:
   throws immediately if the returned `season.year` doesn't match the
   requested one, instead of silently feeding wrong-season data into
   ratings/stats. Querying the *current* season (2026) still works
   correctly — this only affects asking for a season ESPN considers "in
   the past" relative to whatever internal clock drives its default.

## Data integrity check

Before trusting any of the numbers below, three of the NFL backtest's
week-1 predictions were cross-checked against real, independently-known
2025 results:

| Game | Backtest actualMargin/actualTotal | Real result |
|---|---|---|
| PHI vs DAL | margin 4, total 44 | Eagles beat Cowboys 24-20 in the real season opener — matches |
| LAC vs KC | margin 6, total 48 | Chargers beat Chiefs 27-21 in São Paulo — matches |
| BUF vs BAL | margin 1, total 81 | Bills beat Ravens 41-40 in a Thursday-night shootout — matches |

Confirms the saved backtest data is real, not corrupted by the season-drift
bug above (that drift happened *after* this data was fetched).

## NFL 2025 (272 games)

| Metric | Full model | Elo only (same 272 games, from the Elo-only report) |
|---|---|---|
| Brier score | 0.231 | 0.227 |
| Favorite accuracy | 60.9% | 62.7% |
| Spread MAE | 11.0 pts | 10.3 pts |
| Spread bias | +0.4 pts | -0.2 pts |
| Total MAE | 14.1 pts | _(not measured for Elo-only — no total signal)_ |

## CFB 2025 (714 games — excludes week 1, which has no prior-week stats to build from)

Elo-only numbers here are recomputed on the exact same 714-game sample (not
the Elo-only report's full 762, which included week 1) for a true
apples-to-apples comparison.

| Metric | Full model | Elo only (same 714 games) |
|---|---|---|
| Brier score | 0.181 | 0.183 |
| Favorite accuracy | 71.8% | 73.0% |
| Spread MAE | 13.9 pts | 12.8 pts |
| Spread bias | +2.0 pts | -2.0 pts |
| Total MAE | 17.6 pts | _(not measured for Elo-only)_ |

## Honest conclusion

**On this one season, for both leagues, adding season-to-date box-score
stats + EPA on top of Elo did not improve accuracy — it made spread
predictions slightly worse** (NFL: MAE 10.3→11.0, favorite accuracy
62.7%→60.9%; CFB: MAE 12.8→13.9, favorite accuracy 73.0%→71.8%). Brier
score is roughly a wash both ways (essentially flat for NFL, marginally
better for CFB). The spread bias also flipped sign in both leagues (CFB:
-2.0→+2.0; NFL: -0.2→+0.4) — the blend isn't just adding noise
symmetrically, it's shifting predictions in a consistent direction.

This is a real, actionable finding, not a wash: it suggests the current
blend weights between Elo and the stats/EPA signals (set by feel when each
signal was added, never tuned against a backtest since this is the first
one that could validate the full blend) are probably not well-calibrated —
plausibly overweighting the stats/EPA side relative to how much real
predictive signal a single season's box-score averages actually carry
beyond what Elo already captures. Worth a follow-up pass at reweighting the
blend against this now-working backtest infrastructure, rather than trusting
the original by-feel weights going forward.

## What this still doesn't tell us

- **Weather and starter injuries** aren't included (no honest historical
  source for either — see file header). Both are real, live-verified
  signals in the actual weekly pipeline (see the CFB-parity-gap work) —
  just not backtestable yet.
- **One season is a small sample** for a bias/weighting diagnosis — the
  direction (full model worse) is consistent across both leagues, which is
  more convincing than either alone, but a second season's data would
  strengthen this before making it the basis of a weight change.
- **The referee, injury, EPA, and market signals are individually
  live-verified** (this session and earlier), just not jointly backtested
  outside of what's summarized above.
