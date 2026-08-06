// Replays a completed NFL season week-by-week using only real game
// results, to backtest the Elo power-rating signal without lookahead —
// see analysis/backtest.js's file header for why Elo specifically (it's
// the one signal in this project that's cleanly reconstructable
// point-in-time) and what this does and doesn't validate.
//
// Seeding is real, not synthetic: ratings start from the PRIOR season's
// final team stats (same seedSeasonRatings call the live pipeline uses in
// weeklyUpdate.js) — this isn't lookahead, since a fully-completed prior
// season is legitimately known before the season being backtested starts.
// From there, ratings only ever update from games that have already been
// played, and every prediction is recorded using the ratings as they stood
// immediately BEFORE that week's results were applied.

import { fetchWeekScoreboard, fetchTeamsIndex, fetchTeamSeasonStats } from './providers/statsProvider.js';
import { mapEspnStatsToModel } from './weeklyUpdate.js';
import { seedSeasonRatings, applyResults } from './ratingsStore.js';
import { matchupWinProbability, winProbToSpread } from './analysis/powerRatings.js';

export async function backtestNflSeason(season, { weeks = Array.from({ length: 18 }, (_, i) => i + 1) } = {}) {
  const teamsIndex = await fetchTeamsIndex();
  const priorSeasonStats = {};
  for (const t of teamsIndex) {
    try {
      const raw = await fetchTeamSeasonStats(season - 1, t.id);
      priorSeasonStats[t.abbr] = mapEspnStatsToModel(t.abbr, raw);
    } catch {
      // A team without a fetchable prior season (rare — relocation,
      // expansion) just seeds at league average via seedSeasonRatings'
      // own fallback, rather than aborting the whole backtest.
    }
  }
  let ratings = seedSeasonRatings(priorSeasonStats);

  const predictions = [];
  for (const week of weeks) {
    const games = await fetchWeekScoreboard(season, week);
    const completed = games.filter((g) => g.completed && g.home.score != null && g.away.score != null);
    for (const g of completed) {
      const homeRating = ratings[g.home.abbr];
      const awayRating = ratings[g.away.abbr];
      if (homeRating == null || awayRating == null) continue;
      const homeWinProb = matchupWinProbability({ homeRating, awayRating, neutralSite: g.neutralSite });
      predictions.push({
        season, week, homeTeam: g.home.abbr, awayTeam: g.away.abbr,
        homeWinProb, homeWon: g.home.score > g.away.score,
        projectedSpread: winProbToSpread(homeWinProb),
        actualMargin: g.home.score - g.away.score,
      });
    }
    ratings = applyResults(ratings, completed);
  }
  return predictions;
}
