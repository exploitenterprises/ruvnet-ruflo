// Odds math: American <-> implied probability, vig removal, EV, and Kelly staking.
// Pure functions, no I/O — this is the layer that decides what "value" means.

export function americanToImplied(americanOdds) {
  if (americanOdds > 0) return 100 / (americanOdds + 100);
  return -americanOdds / (-americanOdds + 100);
}

export function americanToDecimal(americanOdds) {
  if (americanOdds > 0) return 1 + americanOdds / 100;
  return 1 + 100 / -americanOdds;
}

export function impliedToAmerican(prob) {
  if (prob <= 0 || prob >= 1) throw new RangeError('prob must be in (0,1)');
  if (prob > 0.5) return -Math.round((prob / (1 - prob)) * 100);
  return Math.round(((1 - prob) / prob) * 100);
}

// Removes the sportsbook's vig from a two-way market (e.g. spread or ML) by
// normalizing the implied probabilities so they sum to 1. This yields the
// market's "fair" (no-vig) probability for each side, which is the correct
// baseline to compare a model's projection against — not the raw juiced price.
export function removeVigTwoWay(americanOddsA, americanOddsB) {
  const pA = americanToImplied(americanOddsA);
  const pB = americanToImplied(americanOddsB);
  const overround = pA + pB;
  return { probA: pA / overround, probB: pB / overround, overround };
}

// N-way vig removal for futures markets (division winners, etc).
export function removeVigMultiWay(americanOddsList) {
  const implied = americanOddsList.map(americanToImplied);
  const overround = implied.reduce((a, b) => a + b, 0);
  return { probs: implied.map((p) => p / overround), overround };
}

// Expected value per 100 units staked, given the model's true win probability
// and the price actually offered by the book.
export function expectedValue(trueProb, americanOdds, stake = 100) {
  const decimal = americanToDecimal(americanOdds);
  const winAmount = stake * (decimal - 1);
  const loseAmount = -stake;
  return trueProb * winAmount + (1 - trueProb) * loseAmount;
}

export function edgePercent(trueProb, americanOdds) {
  const impliedFair = americanToImplied(americanOdds);
  return (trueProb - impliedFair) * 100;
}

// Kelly criterion stake as a fraction of bankroll. `fraction` applies a
// fractional-Kelly haircut (default quarter-Kelly) to control for model
// uncertainty — full Kelly is only correct if trueProb is exactly right,
// and it never is in sports betting.
export function kellyStake(trueProb, americanOdds, fraction = 0.25) {
  const b = americanToDecimal(americanOdds) - 1;
  const q = 1 - trueProb;
  const fullKelly = (b * trueProb - q) / b;
  const capped = Math.max(0, fullKelly);
  return capped * fraction;
}

// Logistic win-probability from a rating differential (Elo-style), with an
// optional additive home-field edge already folded into the diff by the caller.
export function winProbFromRatingDiff(ratingDiff, scale = 400) {
  return 1 / (1 + 10 ** (-ratingDiff / scale));
}
