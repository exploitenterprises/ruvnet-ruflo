import { edgePercent, expectedValue, kellyStake, removeVigTwoWay } from './probability.js';
import { coverProbability, overProbability } from './statMath.js';

const MIN_EDGE_PCT = 2.5; // below this, treat as noise given model uncertainty

// `lines` is an array of book quotes for one game:
// { book, market: 'spread'|'moneyline'|'total', side: 'home'|'away'|'over'|'under', price, points }
// `projection` is the output of matchupEngine.projectGame(...).
export function findValueBets(projection, lines) {
  const results = [];
  const byMarketSide = groupByMarketSide(lines);

  for (const [key, quotes] of byMarketSide) {
    const [market, side] = key.split('::');
    const trueProb = modelProbability(projection, market, side, quotes);
    if (trueProb == null) continue;

    // Book-by-book EV comparison for this side, best first. With a single
    // model probability, the best-price book and the best-EV book are always
    // the same book (EV is monotonic in price for fixed trueProb) — that's
    // expected, not a bug, and is why "best odds" and "best EV" surface
    // identically in the UI. Kept as a full list (not just the winner) so
    // the board can show real line-shopping across every book, not just name one.
    const bookComparison = quotes
      .map((q) => ({ book: q.book, price: q.price, points: q.points, evPer100: round2(expectedValue(trueProb, q.price)) }))
      .sort((a, b) => b.evPer100 - a.evPer100);
    const best = bookComparison[0];

    const consensus = consensusFairProb(byMarketSide, market, side);
    const edgeVsBook = edgePercent(trueProb, best.price);
    const edgeVsMarket = consensus != null ? (trueProb - consensus) * 100 : null;

    if (edgeVsBook >= MIN_EDGE_PCT && (edgeVsMarket == null || edgeVsMarket > 0)) {
      results.push({
        game: `${projection.away} @ ${projection.home}`,
        market,
        side,
        points: best.points,
        book: best.book,
        price: best.price,
        modelProb: round3(trueProb),
        marketFairProb: consensus != null ? round3(consensus) : null,
        edgeVsBookPct: round2(edgeVsBook),
        edgeVsMarketPct: edgeVsMarket != null ? round2(edgeVsMarket) : null,
        expectedValuePer100: best.evPer100,
        kellyStakePct: round2(kellyStake(trueProb, best.price) * 100),
        bookComparison,
      });
    }
  }

  return results.sort((a, b) => b.edgeVsBookPct - a.edgeVsBookPct);
}

function modelProbability(projection, market, side, quotes) {
  if (market === 'moneyline') {
    return side === 'home' ? projection.homeWinProb : projection.awayWinProb;
  }
  if (market === 'spread') {
    const points = medianPoints(quotes);
    if (points == null) return null;
    const homeCover = coverProbability(projection.projectedSpread, side === 'home' ? points : -points);
    return side === 'home' ? homeCover : 1 - homeCover;
  }
  if (market === 'total') {
    const points = medianPoints(quotes);
    if (points == null) return null;
    const over = overProbability(projection.projectedTotal, points);
    return side === 'over' ? over : 1 - over;
  }
  return null;
}

// Cross-book no-vig consensus for the opposite-side pair, used as a sanity
// check: only surface bets where the model *also* disagrees with the market
// consensus, not just with one book's price (guards against model overconfidence).
function consensusFairProb(byMarketSide, market, side) {
  const oppositeSide = { home: 'away', away: 'home', over: 'under', under: 'over' }[side];
  const sideQuotes = byMarketSide.get(`${market}::${side}`);
  const oppQuotes = byMarketSide.get(`${market}::${oppositeSide}`);
  if (!sideQuotes?.length || !oppQuotes?.length) return null;
  const avgSidePrice = average(sideQuotes.map((q) => q.price));
  const avgOppPrice = average(oppQuotes.map((q) => q.price));
  const { probA } = removeVigTwoWay(avgSidePrice, avgOppPrice);
  return probA;
}

function groupByMarketSide(lines) {
  const map = new Map();
  for (const line of lines) {
    const key = `${line.market}::${line.side}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(line);
  }
  return map;
}

function medianPoints(quotes) {
  const points = quotes.map((q) => q.points).filter((p) => p != null).sort((a, b) => a - b);
  if (!points.length) return null;
  const mid = Math.floor(points.length / 2);
  return points.length % 2 ? points[mid] : (points[mid - 1] + points[mid]) / 2;
}

function average(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function round2(v) { return Math.round(v * 100) / 100; }
function round3(v) { return Math.round(v * 1000) / 1000; }
