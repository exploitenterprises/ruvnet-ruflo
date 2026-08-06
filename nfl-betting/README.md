# NFL Betting Strategy Engine

A weekly-updating sports analytics engine — NFL plus College Football — that
projects games, scans sportsbook lines for +EV value, and prices futures
(division/conference winners, Super Bowl/national championship) against the
market — built from team stats, home/away splits, weather, and
empirically-derived coaching/scheme tendencies. Published as the "Red Hot
Locks" app-style Artifact, with a separate tab per league.

Standalone Node package, independent of the rest of this repo (claude-flow).
Run it with plain `node`, no build step.

## College Football

CFB reuses the same odds math, value-detection, and weather logic as the NFL
side (`probability.js`, `statMath.js`, `valueFinder.js`, `weatherImpact.js`
are sport-agnostic). Two things are deliberately different:

- **Reference data** (`src/data/cfbConferences.js`) covers the Power 4
  conferences plus the Group of 5/independent programs that actually move
  betting markets — not all 130+ FBS teams. FBS conferences realign often
  enough that an exhaustive roster would need constant upkeep for little
  betting-relevant payoff; extend the list as coverage needs grow.
- **Futures** (`src/analysis/cfbFutures.js`) does no-vig value comparison
  the same way `futures.js` does for the NFL, but skips the Monte Carlo
  bracket simulation — the NFL sim leans on a fixed 32-team/8-division/
  7-seed structure that doesn't map onto a 130+-team field with a 12-team
  CFP (5 conference-champion auto bids + 7 at-large). That's a real
  follow-up project, not something to fake with a simplified stand-in.
- **Second opinion (Hermes)** (`src/providers/hermesProvider.js`,
  `src/analysis/secondOpinion.js`) — an independent cross-check on a pick
  from a Nous Research Hermes model, called via Nous's own OpenAI-compatible
  inference API (`inference-api.nousresearch.com/v1`), not the separate
  "Hermes Agent" CLI product. It's a second *judgment*, not a data source —
  fed the same matchup facts and our pick/reasoning, asked to form an
  independent view and say whether it agrees. Never overrides the in-house
  model; the board is meant to show both and flag disagreement. Needs
  `HERMES_API_KEY` (sign up free at
  <https://portal.nousresearch.com/manage-subscription>) in `nfl-betting/.env`,
  plus `inference-api.nousresearch.com` on this environment's network
  egress allowlist (see the CFBD section below for the general pattern).
  Defaults to the Hermes-4-70B tier; override with `HERMES_MODEL` in `.env`.
- **Live CFB data** (`src/providers/cfbdProvider.js`) pulls team stats,
  talent composite, schedule, and lines from
  [collegefootballdata.com](https://collegefootballdata.com) — free key at
  <https://collegefootballdata.com/key>. Set it in `nfl-betting/.env`
  (git-ignored, never commit it):
  ```
  CFBD_API_KEY=your-key-here
  ```
  then run with `node --env-file=.env cli.js ...`. In a sandboxed dev
  environment (like Claude Code's remote containers), outbound calls to
  `api.collegefootballdata.com` may need to be added to that environment's
  network egress allowlist before this works — same for `api.the-odds-api.com`,
  `site.api.espn.com`, and `api.open-meteo.com` if those show a "host not in
  allowlist" error. That's an environment setting, not a code or key problem.

> **This is a research/decision-support tool, not financial advice.** Sports
> betting outcomes are inherently uncertain; the model can and will be wrong.
> Use fractional Kelly sizing (the default), never stake more than you can
> afford to lose, and treat every number here as one input among several.

## Why it's built this way

"Use all player/team/coach stats and update week to week" implies **live,
current data** — hardcoding last year's numbers into source files would be
wrong the moment the season starts and impossible to keep current. So instead
of a spreadsheet of stats, this ships as a **pipeline**: pluggable data
providers feed a set of pure, tested statistical models, and the whole thing
re-runs every week as real results come in.

```
providers/            live data in                 analysis/                 report
┌────────────────┐                          ┌─────────────────────────┐
│ statsProvider   │ team stats, schedule ──▶ │ powerRatings (Elo/SRS)  │
│ (ESPN, no key)  │                          │ matchupEngine           │──▶ weekly
├─────────────────┤                          │ weatherImpact           │    Markdown
│ weatherProvider │ forecast ───────────────▶│ schemeTendencies        │    + JSON
│ (Open-Meteo)    │                          │ positionMatchup (NGS)   │    report
├─────────────────┤                          │ valueFinder             │
│ oddsProvider    │ sportsbook lines ───────▶ │ futures (Monte Carlo)   │
│ (The Odds API)  │                          │ probability / statMath  │
├─────────────────┤                          └─────────────────────────┘
│ nflverseProvider│ Next Gen Stats + play- ─▶ no key needed, GitHub-hosted
│ (nflverse)      │ by-play (EPA/success)     (feeds teamEpa.js + refereeTendencies.js)
│                 │ + officiating crews
├─────────────────┤
│ injuryProvider  │ depth chart + injury ───▶ no key needed (feeds injuryImpact.js)
│ (ESPN)          │ status per player
├─────────────────┤
│ cfbdProvider    │ CFB stats/lines/talent ─▶ needs CFBD_API_KEY (see below)
│ (collegefootballdata.com)
├─────────────────┤
│ hermesProvider  │ 2nd-opinion judgment ───▶ needs HERMES_API_KEY (see below)
│ (Nous Research) │                          not a data source — see secondOpinion.js
└─────────────────┘
```

## What each piece actually does

- **Power ratings** (`src/analysis/powerRatings.js`) — an Elo rating per team,
  the same family of model FiveThirtyEight's NFL Elo and Football Outsiders'
  SRS use. Seeded from last season's point differential, regressed toward the
  mean for the new season, then updated after every completed game with a
  margin-of-victory multiplier — so it evolves week to week instead of being
  a static preseason snapshot.
- **Matchup engine** (`matchupEngine.js`) — projects a specific game by
  combining (a) the Elo win probability, (b) an opponent-adjusted
  offense-vs-defense point projection built from each team's home/away
  scoring splits, (c) a pass-rush-vs-pass-protection scheme mismatch signal,
  (d) an optional Next Gen Stats position-group edge (see below), (e) tempo
  (pace), and (f) weather. This is the "offense vs. defense, position group
  vs. position group" matchup evaluation.
- **Position matchups / Next Gen Stats** (`positionMatchup.js`, fed by
  `providers/nflverseProvider.js`) — turns real NFL Next Gen Stats (receiver
  separation/YAC, QB time-to-throw/CPOE, RB rush yards over expected) into a
  recency-weighted index per team/position (`computeWeightedHistory`
  defaults to a 50/30/20 weighting across the 3 most recent seasons a team
  has data for), then compares it against the opponent as a >1-favors-offense
  ratio the same way `schemeTendencies.passRushMismatch` does. **Honest
  limit**: there's no free public defensive-player tracking data (coverage
  grades, separation allowed by a specific corner) — this can only
  characterize the strength/trend of the offense's skill positions, not a
  true two-sided "this WR corps vs. this specific CB" matchup. Sourced from
  [nflverse](https://github.com/nflverse/nflverse-data) (community
  republication of official NGS numbers as downloadable files) — no API key
  or OAuth needed, and it's the one live-data source confirmed to work from
  this project's sandboxed dev environment when most sports-data APIs are
  network-blocked.
- **EPA/play** (`teamEpa.js`, fed by `providers/nflverseProvider.js`'s
  `fetchPbp`) — expected points added per play, the efficiency metric the
  wider analytics community (nflfastR, PFF, modern Football Outsiders work)
  treats as the strongest single per-play signal available, ahead of
  points/yards-per-game, because it credits every play for the down/distance/
  field-position situation it happened in rather than just its outcome.
  Aggregated from nflverse's public play-by-play (already-computed `epa`/
  `success` columns from nflfastR) into an offensive and defensive EPA/play +
  success-rate split per team, scoped to completed games only
  (`throughWeek`) so there's no lookahead into the week being projected. In
  `matchupEngine.js` it's folded in as a third, independently-derived margin
  estimate alongside the Elo-implied and efficiency(PPG)-implied margins
  (35/35/30 weighting when available) rather than a small capped nudge like
  the scheme/NGS adjustments — a deliberate choice reflecting how much more
  predictive per-play EPA is than the drive-level stats the rest of the
  engine is built on. Falls back cleanly to the pre-EPA two-way blend when
  play-by-play isn't available yet (early season, or a fetch failure) — see
  `weeklyUpdate.js`'s live-data path.
- **Starter injuries** (`injuryImpact.js`, fed by `providers/injuryProvider.js`'s
  `fetchTeamDepthChart`) — ESPN's public depth-chart endpoint is genuinely
  rank-ordered per position with each athlete's current injury designation
  attached, so this can assert "the starting QB is Out" instead of guessing
  starter status from unordered roster data. **Scope, deliberately narrow**:
  only a confirmed Out/Doubtful/Injured Reserve/PUP/Suspended starting QB
  moves the projection — a flat, capped point subtraction (`QB_OUT_POINT_PENALTY`,
  currently 3) reflecting the commonly-cited market effect of a backup QB
  start, applied last so it isn't compounded by the multiplicative
  adjustments above it. Every other position's real injury impact varies too
  much by player/scheme to state a single honest number, so those surface as
  informational notes only (`starterInjuryNotes`) — same posture as
  `manualCoachNotes`, never silently reweights the model. A missing depth
  chart (fetch failure, bye week) is treated as "no injury data," not an error.
- **Referee-crew tendencies** (`refereeTendencies.js`, fed by
  `providers/nflverseProvider.js`'s `fetchOfficials`) — how many penalties/
  penalty yards a given head referee's games run relative to league average,
  computed from real historical data (nflverse's officials archive, joined
  to its play-by-play by the legacy GSIS game id). **Two scope limits,
  stated plainly**: (1) informational note only, never a point/total
  adjustment — penalty-rate effect size on scoring isn't established well
  enough to state a confident point value the way the QB-out penalty is; (2)
  this is a lookup against *past* games — the NFL doesn't announce which
  crew works an upcoming game until a few days before kickoff, so there's no
  way to know this week's assignment far in advance. Real use is a
  near-kickoff manual check (once an assignment is known, e.g. from ESPN's
  boxscore/summary endpoint) via the optional `referee: { name, penaltyRatio }`
  param on `projectGame`, not a standard input the weekly pipeline
  auto-populates like EPA or injuries.
- **Line movement** (`lineMovement.js` + `lineHistoryStore.js`) — how much a
  game's market spread/total has moved since this pipeline first saw it,
  computed from snapshots this project takes of its own real market-line
  pulls over time (`data/cache/line-history-{nfl,cfb}.json`, git-ignored
  like the ratings cache). **Why self-collected, not a feed**: two realistic
  free sources for "betting market signals" were checked directly against
  this environment's network, not assumed — public bet-percentage/
  sharp-vs-public-money splits (Action Network, Covers consensus) are both
  blocked at the network level here, same pattern as the CFB scouting sites
  documented above; The Odds API's own historical-odds endpoint (confirmed
  reachable — a real key gets real data) is gated behind a paid plan, a cost
  gate rather than a technical one. So this tracks it for free, going
  forward — the real limitation that creates: there's no "movement since
  Tuesday" on the very first run for a game, only once this pipeline has
  actually observed it more than once. Surfaced as informational notes
  (`describeMovement`, half a point of total movement or more) in both the
  weekly NFL report and the CFB edge board — market context, not something
  that feeds back into the model's own projection.
- **Head-to-head / division ATS history** (`atsHistory.js`, fed live by
  `cfbAtsHistory.js` and `nflHeadToHead.js`) — straight-up record, average
  point differential, and (when spread data is available) against-the-spread
  record between two specific teams or across a team's division/conference
  rivals, built entirely from data this project already gathers elsewhere —
  no new external source. **Real asymmetry between the two leagues, checked
  directly**: CFBD's `/lines` returns real historical spreads for past
  weeks/seasons (confirmed by direct use backtesting `cfbEdgeBoard.js`), so
  `cfbAtsHistory.js` gets true ATS. NFL doesn't have a free equivalent —
  ESPN's public boxscore/summary endpoint's `pickcenter`/`odds`/
  `againstTheSpread` fields were checked against real completed games and
  come back empty every time (it doesn't retain closing lines once a game's
  over), and The Odds API's historical-odds endpoint is paid-tier only (same
  finding as line movement, above). So `nflHeadToHead.js` is straight-up
  only — real and useful, just not ATS. Verified live: correctly reproduced
  the actual 2023-2025 Ohio State/Michigan results (including the real 2024
  upset — Ohio State was a 20-point home favorite and lost outright) from
  live CFBD data. Not part of the standard weekly pipeline (ESPN has no bulk
  season-schedule endpoint, so NFL multi-season history costs 18 scoreboard
  calls per season) — call it on demand, not on every refresh.
- **Scheme tendencies** (`schemeTendencies.js`) — "coach scheme" signal
  derived *empirically* from each team's own play-calling data (tempo, pass
  rate, sack rates, 4th-down aggressiveness) relative to league average,
  rather than a hardcoded roster of coaches' names — rosters change every
  offseason and a static list would go stale or simply be wrong. You can
  layer qualitative notes on top via `data/coach-notes.json` (e.g. "new OC,
  different scheme") — those are surfaced in the report, not used to move
  point projections, since free text shouldn't silently reweight a
  statistical model.
- **Weather impact** (`weatherImpact.js`) — converts wind/temp/precipitation
  into multipliers on passing efficiency, scoring, field-goal range, and
  turnover risk. Domes and closed retractable roofs are automatically
  excluded.
- **Odds math** (`probability.js`, `statMath.js`) — American↔implied
  probability, no-vig fair pricing, expected value, and fractional Kelly
  staking (quarter-Kelly by default — full Kelly is only correct if the
  model's probability is exactly right, and it never is).
- **Value finder** (`valueFinder.js`) — for every game/market/side, shops the
  best price across every book quoted, and only flags a bet when the model
  *and* the no-vig cross-book consensus both disagree with that price (guards
  against pure model overconfidence).
- **Futures** (`futures.js`) — Monte Carlo simulation (thousands of full
  season replays) of the remaining schedule to get division-winner,
  playoff-berth, conference-champion, and Super Bowl probabilities, then
  compares those to futures market prices for value. Tiebreakers
  (head-to-head, strength of victory, etc.) are **not** modeled — ties are
  broken randomly; call this out to anyone using the output.

## Pick philosophy

Against-the-spread is the primary weekly signal for both leagues — every
committed game pick defaults to a spread call. Moneylines aren't posted
just because a price exists; one gets added only when the model has real
separation from the market. Totals stay supporting context unless there's
a genuine edge there too. Every market gets exactly one call — "Our Pick" —
never a ranked list of who has the best price across sportsbooks; where the
model has no real edge over the market, the honest pick is "no play,"
stated plainly rather than hedged.

## Units

Every committed pick carries a `units` field (1-5) sizing it by conviction —
1 is a lean, 5 is the strongest call on the board. This isn't Kelly staking
(see `kellyStake` in `probability.js` for that, used for bankroll-percentage
sizing) — it's the simpler, standard handicapping convention of a flat
unit scale, chosen because it's what the app displays to users deciding
how much weight to put on a pick, not an internal bankroll calculation.
`picksLedger.addPick` defaults `units` to `1` if the caller omits it, so
an old or hand-edited entry still counts toward the season total instead
of silently vanishing from it.

## Track record

`data/picks-ledger.json` is the append-only log of every pick the board has
actually **committed to** — a clear side/selection with a price, not a
hedged "market snapshot" read. Each entry also carries `sport` ('nfl'|'cfb'),
`market` ('spread'|'moneyline'|'total'), and `units` (see above) so the
record can be scoped either way. `src/picksLedger.js` has `addPick` (log a
new pending pick, id-idempotent) and `settlePick` (grade it win/loss/push
once the game's final). `src/analysis/trackRecord.js` turns that ledger
into what the board displays:

- `gradeSummary(picks, category?)` — win/loss/push/pending counts and win%
  (pushes and pending picks are excluded from the win% denominator, standard
  handicapping convention), overall or scoped to `'game'` / `'prop'`.
- `currentStreak(picks)` / `longestStreak(picks, type)` — the app's own
  streak of correct calls, skipping pushes without breaking the streak.
- `playerStreaks(picks)` — which players are currently on a run of hit props
  ("hot" players), most recent settled prop picks per player. A trend
  signal, not a claim that the streak predicts anything.
- `netUnits(picks, category?)` — the running season unit count: a win pays
  `units * (decimal odds - 1)`, a loss costs the full `units` staked, a push
  is a wash, and pending picks don't count until they settle. This is the
  number behind the board's "Season Units" tile.

The displayed record is only ever derived from the ledger — never
hand-written — so it can't drift from what was actually picked and graded.

## Backtesting

`src/analysis/backtest.js` scores a set of predictions against known outcomes:
calibration buckets (does a "60-70% favorite" actually win 60-70% of the time?),
Brier score, straight-up favorite accuracy, spread MAE/bias, and — the direct test
of whether the edge board's ranking has real predictive value — ATS performance at
increasing model-vs-market disagreement thresholds.

**Scope, stated plainly**: only signals that can be honestly reconstructed
point-in-time (no lookahead) are backtestable today. Power ratings (Elo) qualify —
`src/nflEloBacktest.js` replays a completed NFL season week-by-week using only real
game results (seeded from the real, fully-known prior season); `src/cfbEloBacktest.js`
uses CFBD's own per-game pregame Elo directly, which is already point-in-time. The
full matchup engine (efficiency stats + EPA + weather + scheme blended together)
isn't backtestable yet — CFBD's `/stats/season` and ESPN's `fetchTeamSeasonStats`
are both "as of query time" aggregates, not point-in-time historical snapshots, so
scoring the full model against a past season would silently leak future information
into the past.

Running the NFL backtest for the first time surfaced a real, live-pipeline-affecting
bug, not a hypothetical one: ESPN returns `"WSH"` for Washington while this
project's team table uses `"WAS"`. The mismatch made `ratingsStore.js`'s
`applyResults` compute `undefined + number` (`NaN`), corrupting both teams in the
game and cascading to everyone they played afterward — nearly half of a season's
predictions came back `NaN` before the fix. Fixed at the source
(`statsProvider.js` normalizes the abbreviation) plus a hard defensive guard in
`applyResults` itself, so any future unknown-abbreviation case fails safe (skips
one game) instead of corrupting the league's ratings again — see
`reports/backtest-elo-2025-08-06.md` for the full writeup and the actual numbers
(NFL: Brier 0.227, 62.7% favorite accuracy; CFB: Brier 0.183, 73.1% favorite
accuracy, but a real -2.4pt spread bias that confirms the NFL-calibrated Elo-to-
points conversion constant needs a CFB-specific recalibration — a concrete,
scoped follow-up).

## Setup

```bash
cd nfl-betting
node --test              # run the test suite (45 tests, no network required)
node cli.js update --week 1 --source mock   # offline demo run, no keys needed
```

Reports land in `reports/week-<n>-<season>.md` and `.json`.

### Live data (real stats/odds/weather)

```bash
export ODDS_API_KEY=...      # free tier at https://the-odds-api.com
node cli.js update --week <n> --season <yyyy> --source live
```

- **Team stats & schedule/results**: ESPN's public JSON API
  (`src/providers/statsProvider.js`) — no key required, but it's an
  unofficial/undocumented API, so field names are mapped defensively
  (`mapEspnStatsToModel` in `src/weeklyUpdate.js`) and may need adjusting if
  ESPN changes its schema.
- **Weather**: Open-Meteo (`src/providers/weatherProvider.js`) — free, no key.
- **Sportsbook odds & futures**: The Odds API
  (`src/providers/oddsProvider.js`) — needs `ODDS_API_KEY`. Division-winner
  outright markets aren't consistently listed by every book; check the
  current market catalog at the-odds-api.com before relying on that market.

This container's network egress is locked down by org policy, so the `live`
path is written and unit-testable in isolation but hasn't been exercised
end-to-end here — run it from an environment with outbound HTTPS access.

### Mock mode

`--source mock` runs the identical pipeline against procedurally-generated
synthetic fixtures (`src/providers/mockData.js`) — deterministic, offline,
clearly labeled as fake. It exists so the pipeline, tests, and CI can run
without network access or an API key. Do not mistake its "value bets" output
for real signal — the synthetic model and synthetic odds are generated
independently of each other, so their disagreement rate is much higher than
you'd see against a real, efficient market.

## Weekly workflow

1. Run `node cli.js update --week <n> --season <yyyy> --source live` each
   week during the season (a cron job or CI schedule works well).
2. Ratings persist in `data/cache/ratings.json` and roll forward
   automatically as each week's results come in — you don't need to reset
   anything between weeks.
3. Read the generated Markdown report for that week's matchup breakdowns,
   value bets (sorted by edge), and futures value.
4. Optionally edit `data/coach-notes.json` with any qualitative context
   (coordinator changes, injuries you want flagged) before running.

## Limitations, stated plainly

- Player-level, snap-by-snap matchup data (e.g. "which CB covers which WR")
  isn't available from free public sources, so position-group matchups are
  evaluated at the unit level (pass offense vs. pass defense, etc.), not
  individual-player-vs-player.
- Playoff/futures tiebreakers are simplified (randomized among ties).
- The margin/total standard deviations used to price spreads and totals
  (13.5 / 10 points) are fixed constants based on typical NFL variance, not
  re-estimated from the current season's data.
- ESPN's stats API is unofficial and can change without notice.
