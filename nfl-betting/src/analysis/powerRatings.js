// Elo-style power ratings with a margin-of-victory multiplier (the same family
// of model used by FiveThirtyEight's NFL Elo and Football Outsiders' SRS).
// Ratings are seeded once per season from prior-year point differential and
// then updated after every completed game, so "this week's" rating always
// reflects the latest results — this is what makes the model update week to
// week instead of being a static snapshot.

const LEAGUE_AVG_RATING = 1500;
const HOME_FIELD_ELO = 48; // ~2.2 point home edge, consistent with long-run NFL home advantage
const K_FACTOR = 20;

// Elo points per point of scoring margin — how "wide" a rating scale has to
// be to represent a given real-world margin. 25 is the standard NFL Elo
// scaling (FiveThirtyEight-style).
//
// Investigated whether CFBD's own CFB Elo (a much wider scale — 2025
// season: 718-2346) needs a different constant, prompted by
// cfbEloBacktest.js's -2.4pt spread bias finding. First attempt fit
// eloDiff ~= K * actualMargin (regressing eloDiff on margin) and got K≈8.7
// — wrong: that minimizes error in eloDiff-space, not in the
// projectedSpread-vs-actualMargin space that actually matters, and using
// it made the real backtest MAE measurably worse (12.9 -> 20.8 pts).
// Correct fit minimizes sum((eloDiff/K - margin)^2) directly, giving
// K = sum(eloDiff^2) / sum(eloDiff*margin) ≈ 23 (confirmed independently by
// a direct grid search over K minimizing MAE — same answer). At K=23 vs
// the NFL's 25, MAE is statistically identical (13.16 either way across
// 1514 real 2024+2025 games) and bias only improves marginally (-2.20 to
// -1.95) — i.e. the constant was never the real source of the bias. Using
// 23 anyway since it's the empirically-verified best single value, but
// this is a minor correction, not the 3x rescaling first (wrongly) found.
const NFL_ELO_POINTS_PER_MARGIN = 25;
const CFB_ELO_POINTS_PER_MARGIN = 23;

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

// Convert an Elo win probability into an approximate point spread using an
// Elo-points-per-margin-point relationship (inverse of seedRating scaling).
// Defaults to the NFL constant — pass `eloPointsPerMargin: CFB_ELO_POINTS_PER_MARGIN`
// (or the named export below) for CFB ratings, which use a much wider Elo scale.
export function winProbToSpread(winProb, eloPointsPerMargin = NFL_ELO_POINTS_PER_MARGIN) {
  const clamped = Math.min(Math.max(winProb, 0.001), 0.999);
  const eloDiff = -400 * Math.log10(1 / clamped - 1);
  return eloDiff / eloPointsPerMargin; // positive => favorite (home) margin in points
}

export const CONSTANTS = {
  LEAGUE_AVG_RATING, HOME_FIELD_ELO, K_FACTOR,
  NFL_ELO_POINTS_PER_MARGIN, CFB_ELO_POINTS_PER_MARGIN,
};
