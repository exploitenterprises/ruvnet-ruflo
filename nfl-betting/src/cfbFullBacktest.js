// Backtests the FULL matchup-engine blend (season-to-date box-score stats +
// Elo + EPA/play) for a completed CFB season — the CFB counterpart to
// nflFullBacktest.js, but much lighter: CFBD's /stats/season and
// /stats/season/advanced genuinely support startWeek/endWeek point-in-time
// scoping (confirmed live — see providers/cfbdProvider.js's fetchSeasonStats/
// fetchAdvancedTeamStats), so there's no need to reconstruct point-in-time
// stats from individual game boxscores the way the NFL side has to. Elo is
// already point-in-time via CFBD's own homePregameElo/awayPregameElo (same
// as cfbEloBacktest.js).
//
// Weather is deliberately OMITTED, not faked — same reasoning as
// nflFullBacktest.js: no honest historical-forecast source is wired up.
// Every projection passes `{ isDome: true }` (no weather adjustment).
//
// Week 1 has no prior weeks to build point-in-time stats from, so it's
// skipped entirely rather than projected off empty/fallback data — same
// "real data or nothing" posture as pointInTimeStats.js's fallbackProfile,
// just applied at the week level here since CFBD gives us all teams'
// point-in-time stats in one call (no team-by-team fallback needed).

import { projectGame } from './analysis/matchupEngine.js';
import { computeLeagueAverages } from './analysis/leagueAverages.js';
import { CONSTANTS as ELO_CONSTANTS } from './analysis/powerRatings.js';
import { groupStatsByTeam, computeTeamPointsSplits, mapCfbdStatsToModel, mapCfbdAdvancedToEpaSplits } from './analysis/cfbStats.js';

export async function backtestCfbFullModel(season, { weeks = Array.from({ length: 15 }, (_, i) => i + 2) } = {}) {
  const cfbdProvider = await import('./providers/cfbdProvider.js');
  const allGames = await cfbdProvider.fetchGames(season);

  const predictions = [];
  for (const week of weeks) {
    const slate = allGames.filter((g) => g.week === week && g.completed && g.homePoints != null && g.awayPoints != null);
    if (slate.length === 0) continue;

    const [statRows, advancedRows] = await Promise.all([
      cfbdProvider.fetchSeasonStats(season, { startWeek: 1, endWeek: week - 1 }),
      cfbdProvider.fetchAdvancedTeamStats(season, { startWeek: 1, endWeek: week - 1 }),
    ]);
    const statsByTeam = groupStatsByTeam(statRows);
    const epaSplitsByTeam = mapCfbdAdvancedToEpaSplits(advancedRows);

    const seasonStatsByTeam = {};
    for (const team of Object.keys(statsByTeam)) {
      const pointsSplits = computeTeamPointsSplits(allGames, team, { throughWeek: week - 1 });
      seasonStatsByTeam[team] = mapCfbdStatsToModel(team, statsByTeam[team], pointsSplits);
    }
    if (Object.keys(seasonStatsByTeam).length === 0) continue;
    const leagueAvg = computeLeagueAverages(Object.values(seasonStatsByTeam));

    for (const g of slate) {
      // A team with zero games through week-1 (hasn't played yet — a bye
      // or a scheduling quirk) or missing pregame Elo isn't projected —
      // skipped rather than faked with a league-average stand-in.
      const homeStats = seasonStatsByTeam[g.homeTeam];
      const awayStats = seasonStatsByTeam[g.awayTeam];
      if (!homeStats || !awayStats || homeStats.gamesPlayed === 0 || awayStats.gamesPlayed === 0) continue;
      if (g.homePregameElo == null || g.awayPregameElo == null) continue;

      const proj = projectGame({
        home: { abbr: g.homeTeam, stats: homeStats, rating: g.homePregameElo },
        away: { abbr: g.awayTeam, stats: awayStats, rating: g.awayPregameElo },
        leagueAvg,
        weather: { isDome: true }, // see file header
        neutralSite: g.neutralSite,
        eloPointsPerMargin: ELO_CONSTANTS.CFB_ELO_POINTS_PER_MARGIN,
        epaSplits: { home: epaSplitsByTeam[g.homeTeam], away: epaSplitsByTeam[g.awayTeam] },
      });

      predictions.push({
        season, week, homeTeam: g.homeTeam, awayTeam: g.awayTeam,
        homeWinProb: proj.homeWinProb, homeWon: g.homePoints > g.awayPoints,
        projectedSpread: proj.projectedSpread, actualMargin: g.homePoints - g.awayPoints,
        projectedTotal: proj.projectedTotal, actualTotal: g.homePoints + g.awayPoints,
      });
    }
  }
  return predictions;
}
