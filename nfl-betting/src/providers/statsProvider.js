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

// Final scores + schedule for a given season/week. seasontype: 2 = regular season, 3 = postseason.
//
// Real, observed failure mode (not hypothetical): this endpoint silently
// stopped honoring `year` at some point during a live session — a request
// for year=2025 week=1 returned season.year: 2026 instead (the *next*
// season's not-yet-played opener), with no error, no redirect, just a
// wrong-season payload shaped identically to a right-season one. Caught only
// because a full-season backtest's week-1 result happened to be re-checked
// against a known real score after the drift occurred. Guarding here rather
// than downstream: silently ingesting the wrong season would look like
// ordinary (if unlucky) data to every caller — ratingsStore, the live
// weekly pipeline, backtests — all of which trust `completed`/scores at
// face value. Failing loudly with the season it actually got back turns a
// silent data-corruption risk into an obvious, debuggable error instead.
export async function fetchWeekScoreboard(season, week, seasontype = 2) {
  const json = await getJson(`${BASE}/scoreboard?year=${season}&week=${week}&seasontype=${seasontype}`);
  if (json.season?.year != null && json.season.year !== season) {
    throw new Error(`ESPN scoreboard returned season ${json.season.year} for a year=${season} request (week ${week}) — the API silently ignored the year param.`);
  }
  return (json.events ?? []).map((event) => {
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
