// Backtests CFBD's Elo ratings for a completed CFB season — simpler than
// the NFL side (nflEloBacktest.js) because CFBD embeds each game's own
// pregame Elo directly in fetchGames (homePregameElo/awayPregameElo),
// genuinely point-in-time as it stood before that specific game, not an
// as-of-query-time snapshot. No season replay needed — see
// analysis/backtest.js's file header for what this does and doesn't validate.

import { fetchGames } from './providers/cfbdProvider.js';
import { matchupWinProbability, winProbToSpread, CONSTANTS as ELO_CONSTANTS } from './analysis/powerRatings.js';

export async function backtestCfbSeason(season) {
  const games = await fetchGames(season);
  const predictions = [];
  for (const g of games) {
    if (!g.completed || g.homePoints == null || g.awayPoints == null) continue;
    if (g.homePregameElo == null || g.awayPregameElo == null) continue;
    const homeWinProb = matchupWinProbability({
      homeRating: g.homePregameElo, awayRating: g.awayPregameElo, neutralSite: g.neutralSite,
    });
    predictions.push({
      season, week: g.week, homeTeam: g.homeTeam, awayTeam: g.awayTeam,
      homeWinProb, homeWon: g.homePoints > g.awayPoints,
      projectedSpread: winProbToSpread(homeWinProb, ELO_CONSTANTS.CFB_ELO_POINTS_PER_MARGIN),
      actualMargin: g.homePoints - g.awayPoints,
    });
  }
  return predictions;
}
