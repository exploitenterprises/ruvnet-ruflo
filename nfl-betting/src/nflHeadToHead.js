// Live-data counterpart to analysis/atsHistory.js for NFL — straight-up
// only (record + average point differential, no ATS). See atsHistory.js's
// file header for why: no free source for historical NFL closing spreads
// exists — checked directly against ESPN's public boxscore/summary
// endpoint (pickcenter/odds/againstTheSpread all come back empty on real
// completed games) and against The Odds API (historical-odds is paid-tier
// only). Straight-up history is still real and useful on its own.
//
// Not part of the standard weekly pipeline — 18 scoreboard calls per
// season (ESPN has no bulk season-schedule endpoint the way CFBD does) is
// too much to run on every weekly refresh; call this on demand.

import { fetchWeekScoreboard } from './providers/statsProvider.js';
import { headToHeadRecord, divisionTrend } from './analysis/atsHistory.js';

async function fetchSeasonGames(season, weeks = Array.from({ length: 18 }, (_, i) => i + 1)) {
  const perWeek = await Promise.all(weeks.map((week) => fetchWeekScoreboard(season, week)));
  return perWeek.flat().filter((g) => g.completed).map((g) => ({
    season, homeTeam: g.home.abbr, awayTeam: g.away.abbr, homeScore: g.home.score, awayScore: g.away.score,
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
