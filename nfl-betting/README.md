# NFL Betting Strategy Engine

A weekly-updating NFL analytics engine that projects every game on the slate,
scans sportsbook lines for +EV value, and prices futures (division winners,
conference champs, Super Bowl) against the market — built from team stats,
home/away splits, weather, and empirically-derived coaching/scheme tendencies.

Standalone Node package, independent of the rest of this repo (claude-flow).
Run it with plain `node`, no build step.

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
│ (Open-Meteo)    │                          │ valueFinder             │    report
├─────────────────┤                          │ futures (Monte Carlo)   │
│ oddsProvider    │ sportsbook lines ───────▶ │ probability / statMath  │
│ (The Odds API)  │                          └─────────────────────────┘
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
  (d) tempo (pace), and (e) weather. This is the "offense vs. defense,
  position group vs. position group" matchup evaluation.
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
