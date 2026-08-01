// Elo-style power ratings with a margin-of-victory multiplier (the same family
// of model used by FiveThirtyEight's NFL Elo and Football Outsiders' SRS).
// Ratings are seeded once per season from prior-year point differential and
// then updated after every completed game, so "this week's" rating always
// reflects the latest results — this is what makes the model update week to
// week instead of being a static snapshot.

const LEAGUE_AVG_RATING = 1500;
const HOME_FIELD_ELO = 48; // ~2.2 point home edge, consistent with long-run NFL home advantage
const K_FACTOR = 20;

// Seed a team's rating from prior-season point differential per game.
// ~25 Elo points per point of average scoring margin is the standard NFL Elo scaling.
export function seedRating(priorSeasonPointDiffPerGame) {
  return LEAGUE_AVG_RATING + 25 * priorSeasonPointDiffPerGame;
}

// Regress every team's rating partway back to league average between seasons
// (standard practice — talent and scheme churn season to season).
export function regressToMean(rating, weight = 1 / 3) {
  return rating * (1 - weight) + LEAGUE_AVG_RATING * weight;
}

function movMultiplier(pointMargin, eloDiffOfWinner) {
  return Math.log(Math.abs(pointMargin) + 1) * (2.2 / (eloDiffOfWinner * 0.001 + 2.2));
}

// Update ratings after one completed game.
// homeScore/awayScore are final scores; ratings are the pre-game Elo ratings.
export function updateRatingsAfterGame({ homeRating, awayRating, homeScore, awayScore, neutralSite = false }) {
  const hfa = neutralSite ? 0 : HOME_FIELD_ELO;
  const eloDiff = homeRating + hfa - awayRating;
  const expectedHome = 1 / (1 + 10 ** (-eloDiff / 400));
  const actualHome = homeScore === awayScore ? 0.5 : homeScore > awayScore ? 1 : 0;

  const margin = homeScore - awayScore;
  const winnerEloDiff = margin >= 0 ? eloDiff : -eloDiff;
  const mult = movMultiplier(margin, winnerEloDiff);

  const shift = K_FACTOR * mult * (actualHome - expectedHome);
  return {
    homeRating: homeRating + shift,
    awayRating: awayRating - shift,
  };
}

// Win probability for a matchup given current ratings, home/away roles, and
// whether the site is neutral (e.g. international games).
export function matchupWinProbability({ homeRating, awayRating, neutralSite = false }) {
  const hfa = neutralSite ? 0 : HOME_FIELD_ELO;
  const eloDiff = homeRating + hfa - awayRating;
  return 1 / (1 + 10 ** (-eloDiff / 400));
}

// Convert an Elo win probability into an approximate point spread using the
// standard ~25 Elo-points-per-point relationship (inverse of seedRating scaling).
export function winProbToSpread(winProb) {
  const clamped = Math.min(Math.max(winProb, 0.001), 0.999);
  const eloDiff = -400 * Math.log10(1 / clamped - 1);
  return eloDiff / 25; // positive => favorite (home) margin in points
}

export const CONSTANTS = { LEAGUE_AVG_RATING, HOME_FIELD_ELO, K_FACTOR };
