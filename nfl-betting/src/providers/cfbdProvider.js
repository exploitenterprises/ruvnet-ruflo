// College Football Data (CFBD) provider — https://collegefootballdata.com
// Requires CFBD_API_KEY (free tier at collegefootballdata.com/key). This is
// the CFB-side equivalent of statsProvider.js: real team stats, schedule,
// and — unlike ESPN's unofficial API — advanced/efficiency metrics and a
// team talent composite, which the CFB matchup engine doesn't have access
// to yet (see nfl-betting/README.md#college-football for that gap).
//
// Needs api.collegefootballdata.com allowlisted for outbound network access
// in this environment's settings — see nfl-betting/README.md.

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

export async function fetchFbsTeams(year) {
  const teams = await getJson(`/teams/fbs?year=${year}`);
  return teams.map((t) => ({ school: t.school, abbreviation: t.abbreviation, conference: t.conference, classification: t.classification }));
}

// Team talent composite: a 247/On3-style aggregate ranking of roster talent,
// useful as an independent cross-check against results-based power ratings
// (a team can look good on point differential from a weak schedule but be
// thin on talent, or vice versa).
export async function fetchTalentComposite(year) {
  const rows = await getJson(`/talent?year=${year}`);
  return rows.map((r) => ({ school: r.school, talent: r.talent }));
}

// Season-to-date advanced team stats (success rate, PPA/EPA-equivalent,
// explosiveness) — the CFB analogue of nflfastR's EPA, and the missing piece
// for building a CFB matchup engine as rigorous as the NFL side's.
export async function fetchAdvancedTeamStats(year, team) {
  const params = new URLSearchParams({ year: String(year) });
  if (team) params.set('team', team);
  return getJson(`/stats/season/advanced?${params}`);
}

export async function fetchGames(year, { week, seasonType = 'regular' } = {}) {
  const params = new URLSearchParams({ year: String(year), seasonType });
  if (week) params.set('week', String(week));
  const games = await getJson(`/games?${params}`);
  return games.map((g) => ({
    id: g.id,
    week: g.week,
    startDate: g.start_date,
    completed: g.completed,
    neutralSite: g.neutral_site,
    homeTeam: g.home_team, homePoints: g.home_points,
    awayTeam: g.away_team, awayPoints: g.away_points,
    venue: g.venue,
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
