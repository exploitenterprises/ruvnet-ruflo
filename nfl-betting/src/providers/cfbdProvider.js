// College Football Data (CFBD) provider — https://collegefootballdata.com
// Requires CFBD_API_KEY (free tier at collegefootballdata.com/key). This is
// the CFB-side equivalent of statsProvider.js: real team stats, schedule,
// and — unlike ESPN's unofficial API — advanced/efficiency metrics and a
// team talent composite, which the CFB matchup engine doesn't have access
// to yet (see nfl-betting/README.md#college-football for that gap).
//
// Needs api.collegefootballdata.com allowlisted for outbound network access
// in this environment's settings — see nfl-betting/README.md.
//
// CFBD's JSON is camelCase throughout (homeTeam, homePoints, startDate,
// neutralSite, etc.) — confirmed by direct inspection of live responses,
// not assumed from docs. /lines uses the sign convention "spread is the
// home team's spread" (negative = home favored), the opposite of this
// project's projectedSpread convention (positive = home favored) — anything
// comparing the two must negate one of them. /talent's per-team field is
// named "team", not "school" (this file's fetchTalentComposite normalizes
// it to `school` in its return value to match fetchFbsTeams' shape).

const BASE = 'https://api.collegefootballdata.com';

function requireKey() {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error('CFBD_API_KEY is not set — get a free key at https://collegefootballdata.com/key and add it to nfl-betting/.env');
  return key;
}

async function getJson(path) {
  const key = requireKey();
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`CFBD API ${res.status} ${res.statusText} for ${path}`);
  return res.json();
}

// `location` carries real per-stadium lat/lon/dome (confirmed live: e.g.
// Ohio Stadium at 40.0016/-83.0197, dome: false) — CFBD publishes this
// directly, so no hand-curated CFB stadium dataset (the NFL side's
// data/stadiums.js) is needed for weather.
export async function fetchFbsTeams(year) {
  const teams = await getJson(`/teams/fbs?year=${year}`);
  return teams.map((t) => ({
    school: t.school, abbreviation: t.abbreviation, conference: t.conference, classification: t.classification,
    location: t.location ? { name: t.location.name, lat: t.location.latitude, lon: t.location.longitude, dome: !!t.location.dome } : null,
  }));
}

// Team talent composite: a 247/On3-style aggregate ranking of roster talent,
// useful as an independent cross-check against results-based power ratings
// (a team can look good on point differential from a weak schedule but be
// thin on talent, or vice versa).
export async function fetchTalentComposite(year) {
  const rows = await getJson(`/talent?year=${year}`);
  return rows.map((r) => ({ school: r.team, talent: r.talent }));
}

// Season-to-date advanced team stats (success rate, PPA/EPA-equivalent,
// explosiveness) — the CFB analogue of nflfastR's EPA, and the missing piece
// for building a CFB matchup engine as rigorous as the NFL side's.
// `startWeek`/`endWeek` genuinely reconstruct a point-in-time slice, not
// just the full-season aggregate with an ignored filter — confirmed live:
// Air Force's offense.plays was 262 for startWeek=1&endWeek=5 vs. 823 for
// the full season. That's what makes cfbFullBacktest.js possible without
// per-game box-score reconstruction (contrast with the NFL side — ESPN's
// team-statistics endpoint silently ignores a week filter, see
// statsProvider.js's fetchGameBoxscore for why NFL needed that instead).
export async function fetchAdvancedTeamStats(year, { team, startWeek, endWeek } = {}) {
  const params = new URLSearchParams({ year: String(year) });
  if (team) params.set('team', team);
  if (startWeek != null) params.set('startWeek', String(startWeek));
  if (endWeek != null) params.set('endWeek', String(endWeek));
  return getJson(`/stats/season/advanced?${params}`);
}

// Plain box-score-style season totals (netPassingYards, rushingYards, sacks,
// thirdDownConversions/thirdDowns, games, etc.) — one call returns every FBS
// team as a flat array of {team, statName, statValue} rows (confirmed by
// direct inspection: 8568 rows / 136 teams for a full season). This is the
// CFB analogue of statsProvider.js's fetchTeamSeasonStats, and what
// cfbWeeklyUpdate.js maps into matchupEngine's expected shape — unlike
// fetchAdvancedTeamStats, this has no points-for/against, so those still
// need to be derived from fetchGames.
// `startWeek`/`endWeek` genuinely scope this to a point-in-time slice too —
// same confirmation as fetchAdvancedTeamStats above (e.g. Air Force's
// `games` stat was 4 for startWeek=1&endWeek=5 vs. 12 for the full season).
export async function fetchSeasonStats(year, { team, startWeek, endWeek } = {}) {
  const params = new URLSearchParams({ year: String(year) });
  if (team) params.set('team', team);
  if (startWeek != null) params.set('startWeek', String(startWeek));
  if (endWeek != null) params.set('endWeek', String(endWeek));
  return getJson(`/stats/season?${params}`);
}

// CFBD's own Elo ratings, one call for every FBS team. League average lands
// almost exactly on 1500 (confirmed by direct inspection: 1503 avg / 1509
// median across 136 teams for the 2025 season) — matches this project's
// matchupEngine/powerRatings.js LEAGUE_AVG_RATING baseline closely enough to
// plug straight into matchupWinProbability's standard Elo formula. Real,
// established ratings (used in place of building a from-scratch CFB Elo
// engine) — see cfbWeeklyUpdate.js for the one known approximation this
// creates (the Elo-to-point-spread conversion constant is NFL-calibrated).
export async function fetchEloRatings(year) {
  const rows = await getJson(`/ratings/elo?year=${year}`);
  return rows.map((r) => ({ team: r.team, conference: r.conference, elo: r.elo }));
}

export async function fetchGames(year, { week, seasonType = 'regular' } = {}) {
  const params = new URLSearchParams({ year: String(year), seasonType });
  if (week) params.set('week', String(week));
  const games = await getJson(`/games?${params}`);
  return games.map((g) => ({
    id: g.id,
    week: g.week,
    startDate: g.startDate,
    completed: g.completed,
    neutralSite: g.neutralSite,
    homeTeam: g.homeTeam, homePoints: g.homePoints,
    awayTeam: g.awayTeam, awayPoints: g.awayPoints,
    venue: g.venue,
    // Genuinely point-in-time (CFBD's own Elo as it stood immediately
    // before this specific game, not the current/as-of-query-time snapshot
    // fetchEloRatings returns) — the one CFB signal that can be honestly
    // backtested without lookahead. See cfbEloBacktest.js.
    homePregameElo: g.homePregameElo, awayPregameElo: g.awayPregameElo,
  }));
}

// Betting lines CFBD aggregates from multiple books — a structured
// alternative to WebSearch narrative for the click-to-compare panels.
export async function fetchLines(year, { week, team } = {}) {
  const params = new URLSearchParams({ year: String(year) });
  if (week) params.set('week', String(week));
  if (team) params.set('team', team);
  const games = await getJson(`/lines?${params}`);
  return games.map((g) => ({
    id: g.id,
    homeTeam: g.homeTeam, awayTeam: g.awayTeam,
    lines: (g.lines ?? []).map((l) => ({ provider: l.provider, spread: l.spread, overUnder: l.overUnder, homeMoneyline: l.homeMoneyline, awayMoneyline: l.awayMoneyline })),
  }));
}
