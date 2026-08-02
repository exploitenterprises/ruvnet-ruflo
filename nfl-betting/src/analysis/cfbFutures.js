import { removeVigMultiWay, edgePercent } from './probability.js';

// College football futures value, reusing the same no-vig odds math as the
// NFL side (probability.js is sport-agnostic). Deliberately lighter than
// futures.js: NFL's Monte Carlo bracket sim relies on a fixed 32-team/
// 8-division/7-seed structure that doesn't hold for FBS (130+ teams, 10
// conferences that realign, a 12-team CFP with 5 conference-champion auto
// bids + 7 at-large). Modeling that properly is a real project on its own,
// so until it's built, CFB value here comes from comparing a supplied model
// probability (power-rating-based, provided by the caller) against the
// no-vig market consensus — not a full bracket simulation. That gap is
// called out on the board, not hidden.
export function findCfbFuturesValue(modelProbsByTeam, marketOdds, marketLabel) {
  const prices = marketOdds.map((m) => m.price);
  const { probs: fairProbs } = removeVigMultiWay(prices);
  return marketOdds
    .map((m, i) => {
      const modelProb = modelProbsByTeam[m.team];
      if (modelProb == null) return null;
      return {
        market: marketLabel,
        team: m.team,
        price: m.price,
        modelProb: round3(modelProb),
        marketFairProb: round3(fairProbs[i]),
        edgePct: round2(edgePercent(modelProb, m.price)),
      };
    })
    .filter((r) => r && r.edgePct >= 3)
    .sort((a, b) => b.edgePct - a.edgePct);
}

function round2(v) { return Math.round(v * 100) / 100; }
function round3(v) { return Math.round(v * 1000) / 1000; }
