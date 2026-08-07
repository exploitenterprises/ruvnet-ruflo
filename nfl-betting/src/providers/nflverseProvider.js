// nflverse (https://github.com/nflverse/nflverse-data) — the community data
// project that republishes NFL Next Gen Stats as plain downloadable files.
// No API key, no OAuth, and no undocumented NFL.com endpoint to reverse
// engineer — this is the practical way to get NGS data. Confirmed reachable
// in this environment (unlike most odds/stats dashboards, which block
// automated fetches): GitHub release assets aren't behind the same
// restrictions as scraped HTML pages.
//
// Coverage: player-season Next Gen Stats for the three tracked position
// groups — passing (QB), rushing (RB), receiving (WR/TE) — back to 2016.
// There is no free public defensive-player tracking data (separation
// allowed, coverage grades, etc.); that gap is real and stays undocumented
// rather than faked — see positionMatchup.js.
//
// Also covers full play-by-play (fetchPbp — release tag "pbp"), the source
// for team-level EPA/success-rate splits computed in src/analysis/teamEpa.js.
// A season file is ~19MB gzipped / ~48k rows / 372 columns and takes several
// seconds to parse — fine for a weekly batch job, not something to call from
// a hot path or the test suite (teamEpa.js's tests use small fixture rows).

const RELEASE_ROOT = 'https://github.com/nflverse/nflverse-data/releases/download';

async function fetchGzippedCsv(releaseTag, filename) {
  const res = await fetch(`${RELEASE_ROOT}/${releaseTag}/${filename}`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`nflverse-data ${res.status} ${res.statusText} for ${releaseTag}/${filename}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const zlib = await import('node:zlib');
  const csv = zlib.gunzipSync(buf).toString('utf8');
  return parseCsv(csv);
}

// Minimal dependency-free CSV parser. Handles quoted fields (in case a
// player name or team field ever contains a comma) without pulling in a
// package for three files.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function coerceNumeric(rows, numericFields) {
  return rows.map((r) => {
    const out = { ...r };
    for (const f of numericFields) out[f] = out[f] === '' || out[f] == null ? null : Number(out[f]);
    return out;
  });
}

const RECEIVING_NUMERIC = ['season', 'week', 'avg_cushion', 'avg_separation', 'avg_intended_air_yards',
  'percent_share_of_intended_air_yards', 'receptions', 'targets', 'catch_percentage', 'yards',
  'rec_touchdowns', 'avg_yac', 'avg_expected_yac', 'avg_yac_above_expectation'];
const PASSING_NUMERIC = ['season', 'week', 'avg_time_to_throw', 'avg_completed_air_yards', 'avg_intended_air_yards',
  'avg_air_yards_differential', 'aggressiveness', 'max_completed_air_distance', 'avg_air_yards_to_sticks',
  'attempts', 'pass_yards', 'pass_touchdowns', 'interceptions', 'passer_rating', 'completions',
  'completion_percentage', 'expected_completion_percentage', 'completion_percentage_above_expectation', 'avg_air_distance', 'max_air_distance'];
const RUSHING_NUMERIC = ['season', 'week', 'efficiency', 'percent_attempts_gte_eight_defenders', 'avg_time_to_los',
  'rush_attempts', 'rush_yards', 'expected_rush_yards', 'rush_yards_over_expected', 'avg_rush_yards',
  'rush_yards_over_expected_per_att', 'rush_pct_over_expected', 'rush_touchdowns'];

const PBP_NUMERIC = ['week', 'down', 'epa', 'success', 'qb_epa', 'penalty', 'penalty_yards'];
const OFFICIALS_NUMERIC = ['season', 'week', 'jersey_number'];

// Real, live-confirmed data-quality gotcha in all three NGS files: `week: 0`
// isn't preseason or a bye — it's a SEASON-TOTAL row for that player folded
// into the same weekly file (e.g. a "week 0" row with attempts:504,
// pass_yards:3870 for a QB — an entire season's totals, not one game).
// Left in, any per-game aggregation (analysis/playerProps.js's trailing
// averages) silently treats a full season as a single game and inflates
// every rate by roughly a season's worth of extra yardage — caught via
// backtesting a wildly unrealistic 235-yard single-game receiving
// projection back to this row. Filtered once here, at the source, rather
// than in every consumer.
function excludeSeasonAggregateRows(rows) {
  return rows.filter((r) => r.week !== 0);
}

export async function fetchNgsReceiving() {
  return excludeSeasonAggregateRows(coerceNumeric(await fetchGzippedCsv('nextgen_stats', 'ngs_receiving.csv.gz'), RECEIVING_NUMERIC));
}
export async function fetchNgsPassing() {
  return excludeSeasonAggregateRows(coerceNumeric(await fetchGzippedCsv('nextgen_stats', 'ngs_passing.csv.gz'), PASSING_NUMERIC));
}
export async function fetchNgsRushing() {
  return excludeSeasonAggregateRows(coerceNumeric(await fetchGzippedCsv('nextgen_stats', 'ngs_rushing.csv.gz'), RUSHING_NUMERIC));
}

// Full play-by-play for one season — team abbreviations (posteam/defteam),
// play_type, down, and nflfastR's precomputed epa/success columns are what
// teamEpa.js needs; the other ~365 columns pass through unused but
// unfiltered (cheaper to coerce five numeric fields than to hand-pick a
// projection out of 372 column names that could drift release to release).
export async function fetchPbp(season) {
  return coerceNumeric(await fetchGzippedCsv('pbp', `play_by_play_${season}.csv.gz`), PBP_NUMERIC);
}

const GAMES_NUMERIC = ['season', 'week', 'away_score', 'home_score', 'total', 'away_moneyline', 'home_moneyline',
  'spread_line', 'away_spread_odds', 'home_spread_odds', 'total_line', 'under_odds', 'over_odds', 'temp', 'wind'];

// Same "LA" (this file) vs "LAR" (the NGS files, data/teams.js) Rams
// mismatch already fixed once in playerProps.js's buildOpponentSchedule —
// confirmed live here too, the only mismatch across all 32 current teams
// (this file also carries retired franchise codes for old seasons: OAK,
// SD, STL).
const GAMES_ABBR_TO_CANONICAL = { LA: 'LAR' };
function canonicalGameAbbr(abbr) { return GAMES_ABBR_TO_CANONICAL[abbr] ?? abbr; }

// Real historical closing lines for every NFL game back to 1999 (release
// tag "schedules") — confirmed live: `spread_line` uses this project's
// own "positive = home favored" convention already (e.g. a real 2024 game
// where the away team (HOU) was the moneyline favorite has spread_line
// -3, home team IND the underdog — signs match, no negation needed,
// unlike CFBD's lines which use the opposite convention — see
// cfbdProvider.js). This is what makes a REAL market-line backtest
// possible for NFL: analysis/backtest.js's atsThresholdPerformance existed
// but was never actually fed real historical odds before this — every
// prior backtest in this project (Elo-only, full-model, weight tuning)
// compared projections to actual game OUTCOMES, never to what the market
// was actually offering.
export async function fetchHistoricalGameLines(season) {
  const rows = coerceNumeric(await fetchGzippedCsv('schedules', 'games.csv.gz'), GAMES_NUMERIC);
  return rows
    .filter((r) => r.season === season && r.game_type === 'REG')
    .map((r) => ({
      week: r.week, homeTeam: canonicalGameAbbr(r.home_team), awayTeam: canonicalGameAbbr(r.away_team),
      spread: r.spread_line, total: r.total_line,
    }));
}

// Every officiating crew member for every game back to 2015 (release tag
// "officials") — confirmed reachable the same way as the other nflverse
// releases. One row per {game, official}; `position` includes 'Referee'
// (the crew chief, whose name is what betting-market discussion of
// "referee tendencies" actually refers to) plus every other on-field
// position and a long tail of alternates. Joins to fetchPbp's rows via
// `game_id` here == pbp's `old_game_id` (the legacy numeric GSIS id, not
// pbp's own `game_id`, which is season_week_away_home-formatted) — see
// analysis/refereeTendencies.js.
//
// Honest limit: this is a historical archive of who officiated PAST games,
// not a schedule of upcoming crew assignments — the NFL doesn't announce
// officiating crews until a few days before kickoff, so there's no way to
// know which referee is working next week's game this far out. Real use is
// a near-kickoff lookup once an assignment is known (e.g. from ESPN's
// boxscore/summary endpoint once it's posted), not a standard input to the
// week-ahead pipeline the other signals feed.
export async function fetchOfficials() {
  return coerceNumeric(await fetchGzippedCsv('officials', 'officials.csv.gz'), OFFICIALS_NUMERIC);
}
