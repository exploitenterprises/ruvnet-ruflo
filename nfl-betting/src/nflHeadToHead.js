// Live-data counterpart to analysis/atsHistory.js for NFL — now real ATS,
// not just straight-up. Historical closing spreads come from nflverse's
// "schedules" release (providers/nflverseProvider.js's
// fetchHistoricalGameLines) — real spread_line back to 1999, already in
// this project's own "positive = home favored" convention (no negation
// needed, unlike CFBD's /lines — see cfbdProvider.js).
//
// This corrects an earlier, since-disproven claim in this file (and in
// atsHistory.js's header) that no free historical NFL closing-spread
// source exists: ESPN's boxscore/summary endpoint and The Odds API's paid
// historical tier were checked and are genuinely dead ends, but nflverse's
// own schedules file — already used elsewhere in this project for NGS/pbp
// data — was never checked until it was found while building
// atsBacktest.js's real market-line backtest.
//
// Not part of the standard weekly pipeline — 18 scoreboard calls per
// season (ESPN has no bulk season-schedule endpoint the way CFBD does) is
// too much to run on every weekly refresh; call this on demand.

import { fetchWeekScoreboard } from './providers/statsProvider.js';
import { fetchHistoricalGameLines } from './providers/nflverseProvider.js';
import { headToHeadRecord, divisionTrend } from './analysis/atsHistory.js';

async function fetchSeasonGames(season, weeks = Array.from({ length: 18 }, (_, i) => i + 1)) {
  const [perWeek, lines] = await Promise.all([
    // fetchWeekScoreboard's events carry no `week` field of their own (ESPN's
    // scoreboard payload doesn't include it) — tag each game with its
    // request week here, same pattern nflFullBacktest.js already uses.
    Promise.all(weeks.map(async (week) => (await fetchWeekScoreboard(season, week)).map((g) => ({ ...g, week })))),
    fetchHistoricalGameLines(season).catch(() => []), // degrade to straight-up if nflverse is unreachable
  ]);
  const spreadByKey = new Map(lines.map((l) => [`${l.week}|${l.homeTeam}|${l.awayTeam}`, l.spread]));
  return perWeek.flat().filter((g) => g.completed).map((g) => ({
    season, homeTeam: g.home.abbr, awayTeam: g.away.abbr, homeScore: g.home.score, awayScore: g.away.score,
    homeSpread: spreadByKey.get(`${g.week}|${g.home.abbr}|${g.away.abbr}`) ?? null,
  }));
}

export async function fetchNflHeadToHead(teamA, teamB, seasons) {
  const allGames = (await Promise.all(seasons.map((s) => fetchSeasonGames(s)))).flat();
  return headToHeadRecord(allGames, teamA, teamB);
}

export async function fetchNflDivisionTrend(team, opponents, seasons) {
  const allGames = (await Promise.all(seasons.map((s) => fetchSeasonGames(s)))).flat();
  return divisionTrend(allGames, team, opponents);
}
