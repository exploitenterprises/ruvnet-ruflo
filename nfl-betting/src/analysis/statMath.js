// Normal-distribution helpers used to turn a point projection (mean) into a
// cover/over probability against an arbitrary book line. NFL final-margin and
// total distributions are well approximated by a normal distribution with
// std dev ~13.5 pts (margin) and ~10 pts (total) — standard figures used
// across public NFL forecasting models.
export const MARGIN_STD_DEV = 13.5;
export const TOTAL_STD_DEV = 10;

function erf(x) {
  // Abramowitz & Stegun 7.1.26 approximation, accurate to ~1.5e-7.
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(x, mean = 0, stdDev = 1) {
  return 0.5 * (1 + erf((x - mean) / (stdDev * Math.SQRT2)));
}

// P(home covers a spread line), where `line` is the home team's spread as
// posted by the book (e.g. -3.5 means home must win by >3.5).
export function coverProbability(projectedMargin, line, stdDev = MARGIN_STD_DEV) {
  return 1 - normalCdf(-line, projectedMargin, stdDev);
}

export function overProbability(projectedTotal, line, stdDev = TOTAL_STD_DEV) {
  return 1 - normalCdf(line, projectedTotal, stdDev);
}
