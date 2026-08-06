// Live-data counterpart to analysis/atsHistory.js for CFB — fetches real
// historical games + lines across a range of seasons and summarizes
// head-to-head or division/conference ATS trends. CFB gets true ATS here
// because CFBD's historical /lines are real (confirmed by direct use in
// cfbEdgeBoard.js's backtests) — see atsHistory.js for why NFL doesn't.

import { fetchGames, fetchLines } from './providers/cfbdProvider.js';
import { headToHeadRecord, divisionTrend } from './analysis/atsHistory.js';

async function fetchSeasonGamesWithSpreads(season) {
  const [games, lineRecords] = await Promise.all([fetchGames(season), fetchLines(season)]);
  const linesByGameId = Object.fromEntries(lineRecords.map((l) => [l.id, l]));
  return games.filter((g) => g.completed).map((g) => {
    const lineRecord = linesByGameId[g.id];
    const spreadPts = (lineRecord?.lines ?? []).map((l) => l.spread).filter((v) => v != null).sort((a, b) => a - b);
    const medianCfbdSpread = spreadPts.length ? spreadPts[Math.floor(spreadPts.length / 2)] : null;
    // CFBD's spread sign convention (negative = home favored) is the
    // opposite of this project's (positive = home favored) — negate, same
    // as edgeBoard.js's cfbMarketLine (see cfbdProvider.js's file header).
    return {
      season, week: g.week, homeTeam: g.homeTeam, awayTeam: g.awayTeam,
      homeScore: g.homePoints, awayScore: g.awayPoints,
      homeSpread: medianCfbdSpread != null ? -medianCfbdSpread : null,
    };
  });
}

export async function fetchCfbHeadToHead(teamA, teamB, seasons) {
  const allGames = (await Promise.all(seasons.map(fetchSeasonGamesWithSpreads))).flat();
  return headToHeadRecord(allGames, teamA, teamB);
}

export async function fetchCfbDivisionTrend(team, opponents, seasons) {
  const allGames = (await Promise.all(seasons.map(fetchSeasonGamesWithSpreads))).flat();
  return divisionTrend(allGames, team, opponents);
}
