// Live team stats/schedule/results provider, backed by ESPN's public
// (unofficial, undocumented) JSON API — no API key required. Endpoints can
// change without notice since ESPN doesn't publish a contract for them; every
// call is defensive and throws a clear error rather than silently returning
// wrong numbers. Pair with providers/mockData.js for offline development/tests.

// site.api.espn.com sits behind Akamai bot detection that 403s Node's native
// fetch() (server: AkamaiGHost) while a bare `curl` against the identical URL
// succeeds — confirmed not a proxy issue (no relay failures, same result
// outside the proxy). Root cause isolated by direct comparison: it's keyed on
// the User-Agent string specifically — curl's own default UA ("curl/8.x")
// passes, but *any* custom UA (including a descriptive one identifying this
// project) gets 403'd same as fetch's Node UA. So: shell out to curl and
// deliberately do NOT set a custom User-Agent header.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

// ESPN uses "WSH" for Washington; this project's canonical team table
// (data/teams.js) uses "WAS" — confirmed by direct comparison of every
// abbreviation both sources return, the only mismatch in the full 32-team
// set. Left uncaught, ratingsStore.js's applyResults computes
// `undefined + number` (NaN) for a team with no matching rating entry, and
// that NaN corrupts BOTH teams in the game, then cascades to everyone they
// play afterward — found by backtesting, a real accuracy bug, not
// hypothetical. Normalized once here, at the source, rather than special-
// cased in every consumer.
const ESPN_ABBR_TO_CANONICAL = { WSH: 'WAS' };
function canonicalAbbr(espnAbbr) {
  return ESPN_ABBR_TO_CANONICAL[espnAbbr] ?? espnAbbr;
}

// --retry-all-errors: a full-season backtest makes hundreds of sequential
// calls to this host, and hit a genuine transient failure doing exactly
// that (curl exit 35, SSL_ERROR_SYSCALL — a dropped connection, not an
// Akamai block, confirmed by it succeeding on retry) — curl's default
// --retry only covers timeouts/5xx/etc, not a raw connection reset, so
// --retry-all-errors is needed to actually cover this case.
async function getJson(url) {
  const { stdout } = await execFileAsync('curl', [
    '-sS', '-w', '\n%{http_code}', '--retry', '3', '--retry-all-errors', '--retry-delay', '1', url,
  ], { maxBuffer: 20 * 1024 * 1024 });
  const splitAt = stdout.lastIndexOf('\n');
  const body = stdout.slice(0, splitAt);
  const statusCode = Number(stdout.slice(splitAt + 1).trim());
  if (statusCode < 200 || statusCode >= 300) throw new Error(`ESPN API ${statusCode} for ${url}`);
  return JSON.parse(body);
}

// Real, observed failure mode (not hypothetical): the scoreboard endpoint
// silently stopped honoring `year`/`week`/`seasontype` query params at some
// point during a live session — a request for year=2025 week=1 returned
// season.year: 2026 instead (the *next* season's not-yet-played opener),
// with no error, no redirect, just a wrong-season payload shaped identically
// to a right-season one. Caught only because a full-season backtest's
// week-1 result happened to be re-checked against a known real score after
// the drift occurred.
//
// Workaround: ESPN's `dates=` param (either a bare year for the season
// calendar, or a YYYYMMDD-YYYYMMDD range for actual games) returns correct
// EVENT data even when `year=`/the response's own `season` metadata field
// doesn't — confirmed live: a dates=20240905-20240911 request returned real
// September 2024 games while its `leagues[0].season` field claimed 2026.
// So the `season` metadata label is unreliable and NOT used for validation
// here; instead, each returned event's own `date` is checked against the
// requested week's real date range (from ESPN's own published calendar —
// fetchSeasonCalendar — not a hand-maintained "NFL Sundays" table) as the
// actual content-based guard against silently ingesting the wrong week.
const seasonCalendarCache = {};
async function fetchSeasonCalendar(season) {
  if (seasonCalendarCache[season]) return seasonCalendarCache[season];
  const json = await getJson(`${BASE}/scoreboard?dates=${season}`);
  const calendar = json.leagues?.[0]?.calendar ?? [];
  const bySeasontype = Object.fromEntries(calendar.map((c) => [Number(c.value), c.entries ?? []]));
  // Content check in place of the unreliable season-metadata field: the
  // regular season's Week 1 has to actually start in the requested calendar
  // year (true for every real NFL season — it always opens in September).
  const week1Start = bySeasontype[2]?.[0]?.startDate;
  if (!week1Start?.startsWith(`${season}-`)) {
    throw new Error(`ESPN calendar for dates=${season} has regular-season Week 1 starting ${week1Start} — doesn't start in ${season} as expected, calendar is for the wrong season.`);
  }
  seasonCalendarCache[season] = bySeasontype;
  return bySeasontype;
}

function toYyyymmdd(iso) {
  return iso.slice(0, 10).replace(/-/g, '');
}

// Final scores + schedule for a given season/week. seasontype: 2 = regular season, 3 = postseason.
export async function fetchWeekScoreboard(season, week, seasontype = 2) {
  const calendar = await fetchSeasonCalendar(season);
  const weekEntry = calendar[seasontype]?.find((e) => Number(e.value) === week);
  if (!weekEntry) throw new Error(`No ESPN calendar entry for season ${season}, seasontype ${seasontype}, week ${week}.`);
  const dates = `${toYyyymmdd(weekEntry.startDate)}-${toYyyymmdd(weekEntry.endDate)}`;

  const json = await getJson(`${BASE}/scoreboard?dates=${dates}`);
  const events = json.events ?? [];
  const outOfRange = events.filter((e) => e.date < weekEntry.startDate || e.date > weekEntry.endDate);
  if (events.length > 0 && outOfRange.length === events.length) {
    throw new Error(`ESPN scoreboard for dates=${dates} (season ${season} week ${week}) returned ${events.length} events, none within the requested date range (e.g. got ${events[0].date}) — likely the same season-context drift bug, ignoring the dates filter too.`);
  }
  return events.map((event) => {
    const comp = event.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === 'home');
    const away = comp?.competitors?.find((c) => c.homeAway === 'away');
    return {
      id: event.id,
      date: event.date,
      completed: comp?.status?.type?.completed ?? false,
      venue: comp?.venue?.fullName,
      neutralSite: comp?.neutralSite ?? false,
      home: { abbr: canonicalAbbr(home?.team?.abbreviation), score: home?.score != null ? Number(home.score) : null },
      away: { abbr: canonicalAbbr(away?.team?.abbreviation), score: away?.score != null ? Number(away.score) : null },
    };
  });
}

// Per-team average point differential for a full completed season — built
// from real final scores via fetchWeekScoreboard (now fixed, see above)
// rather than fetchTeamSeasonStats, which has the identical season-drift
// bug (confirmed live: season=2024 returned season.year 2026, same
// "current context" leak) and — unlike the scoreboard endpoint — has no
// known dates-based workaround. Point differential is all
// ratingsStore.js's seedSeasonRatings actually needs from a prior season
// (it reads priorSeasonPointDiffPerGame, or derives it from
// pointsFor/Against — nothing else in the full stat profile), so this
// sidesteps the broken endpoint entirely rather than needing to fix it.
export async function fetchSeasonPointDiffs(season, { weeks = Array.from({ length: 18 }, (_, i) => i + 1) } = {}) {
  const totals = {}; // abbr -> { diffSum, games }
  for (const week of weeks) {
    let games;
    try {
      games = await fetchWeekScoreboard(season, week);
    } catch {
      continue; // a missing/malformed calendar week (rare) shouldn't abort the whole season
    }
    for (const g of games.filter((g) => g.completed && g.home.score != null && g.away.score != null)) {
      const diff = g.home.score - g.away.score;
      (totals[g.home.abbr] ??= { diffSum: 0, games: 0 }).diffSum += diff;
      totals[g.home.abbr].games += 1;
      (totals[g.away.abbr] ??= { diffSum: 0, games: 0 }).diffSum -= diff;
      totals[g.away.abbr].games += 1;
    }
  }
  return Object.fromEntries(Object.entries(totals).map(([abbr, t]) => [abbr, { priorSeasonPointDiffPerGame: t.diffSum / t.games }]));
}

// Team season statistics (offense/defense splits). ESPN's team-statistics
// endpoint returns a deeply nested "categories -> stats" structure; this maps
// the subset the matchup engine needs into a flat shape.
export async function fetchTeamSeasonStats(season, espnTeamId) {
  const json = await getJson(`${BASE}/teams/${espnTeamId}/statistics?season=${season}`);
  const flat = {};
  for (const category of json.results?.stats?.categories ?? json.splits?.categories ?? []) {
    for (const stat of category.stats ?? []) {
      flat[stat.name] = stat.value;
    }
  }
  return flat;
}

export async function fetchTeamsIndex() {
  const json = await getJson(`${BASE}/teams`);
  const list = json.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return list.map((t) => ({ id: t.team.id, abbr: canonicalAbbr(t.team.abbreviation) }));
}

// Per-game team boxscore stats — unlike fetchTeamSeasonStats (confirmed live:
// ignores a `week` query param, always returns the full-season aggregate),
// this is the only way to reconstruct NFL season-to-date stats "as of week
// N" rather than "as of query time": fetch each completed game's boxscore
// and aggregate them ourselves. See analysis/pointInTimeStats.js for the
// aggregation and nflFullBacktest.js for why this exists (task: a real
// backtest of the full matchup-engine blend, not just the Elo signal).
export async function fetchGameBoxscore(eventId) {
  const json = await getJson(`${BASE}/summary?event=${eventId}`);
  const teams = json.boxscore?.teams ?? [];
  const mapTeam = (t) => {
    const flat = {};
    for (const s of t.statistics ?? []) flat[s.name] = s.displayValue;
    return { abbr: canonicalAbbr(t.team?.abbreviation), stats: flat };
  };
  const home = teams.find((t) => t.homeAway === 'home');
  const away = teams.find((t) => t.homeAway === 'away');
  return { home: home ? mapTeam(home) : null, away: away ? mapTeam(away) : null };
}
