// Replays a completed NFL season week-by-week using only real game
// results, to backtest the Elo power-rating signal without lookahead —
// see analysis/backtest.js's file header for why Elo specifically (it's
// the one signal in this project that's cleanly reconstructable
// point-in-time) and what this does and doesn't validate.
//
// Seeding is real, not synthetic: ratings start from the PRIOR season's
// real point differential (fetchSeasonPointDiffs, built from real final
// scores — see statsProvider.js for why not fetchTeamSeasonStats, which has
// the same season-drift bug fetchWeekScoreboard had to work around) — this
// isn't lookahead, since a fully-completed prior season is legitimately
// known before the season being backtested starts. From there, ratings only
// ever update from games that have already been played, and every
// prediction is recorded using the ratings as they stood immediately BEFORE
// that week's results were applied.

import { fetchWeekScoreboard, fetchSeasonPointDiffs } from './providers/statsProvider.js';
import { seedSeasonRatings, applyResults } from './ratingsStore.js';
import { matchupWinProbability, winProbToSpread } from './analysis/powerRatings.js';

export async function backtestNflSeason(season, { weeks = Array.from({ length: 18 }, (_, i) => i + 1) } = {}) {
  const priorSeasonStats = await fetchSeasonPointDiffs(season - 1);
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
