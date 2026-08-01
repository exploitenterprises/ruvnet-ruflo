// Live team stats/schedule/results provider, backed by ESPN's public
// (unofficial, undocumented) JSON API — no API key required. Endpoints can
// change without notice since ESPN doesn't publish a contract for them; every
// call is defensive and throws a clear error rather than silently returning
// wrong numbers. Pair with providers/mockData.js for offline development/tests.

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN API ${res.status} ${res.statusText} for ${url}`);
  return res.json();
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
      home: { abbr: home?.team?.abbreviation, score: home?.score != null ? Number(home.score) : null },
      away: { abbr: away?.team?.abbreviation, score: away?.score != null ? Number(away.score) : null },
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
  return list.map((t) => ({ id: t.team.id, abbr: t.team.abbreviation }));
}
