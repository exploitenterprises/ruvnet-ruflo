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

async function getJson(url) {
  const { stdout } = await execFileAsync('curl', ['-sS', '-w', '\n%{http_code}', url]);
  const splitAt = stdout.lastIndexOf('\n');
  const body = stdout.slice(0, splitAt);
  const statusCode = Number(stdout.slice(splitAt + 1).trim());
  if (statusCode < 200 || statusCode >= 300) throw new Error(`ESPN API ${statusCode} for ${url}`);
  return JSON.parse(body);
}

// Final scores + schedule for a given season/week. seasontype: 2 = regular season, 3 = postseason.
export async function fetchWeekScoreboard(season, week, seasontype = 2) {
  const json = await getJson(`${BASE}/scoreboard?year=${season}&week=${week}&seasontype=${seasontype}`);
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
