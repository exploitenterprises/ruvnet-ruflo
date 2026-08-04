// Model-vs-market projection board — "what we think the spread/total should
// be" laid next to what the market has, ranked by how much they disagree.
// Deliberately NOT a picks list (see valueFinder.js for that, which converts
// a projection into a probability and only surfaces a play when there's a
// real +EV edge against a specific price): this shows every game's numbers
// side by side regardless of whether there's a bettable edge, so the size
// of the gap itself is the signal — the user decides what to do with it.

function median(nums) {
  const sorted = [...nums].filter((n) => n != null && Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// NFL: `lines` is the flat per-book array from providers/oddsProvider.js,
// already filtered to one game (`lines.filter((l) => l.gameId === ...)`,
// the same pattern valueFinder.js uses). Home-perspective spread points
// (positive = home favored, matching matchupEngine's projectedSpread) and
// the over-side total points, each a cross-book median.
export function nflMarketLine(lines) {
  const spreadPts = lines.filter((l) => l.market === 'spread' && l.side === 'home').map((l) => l.points);
  const totalPts = lines.filter((l) => l.market === 'total' && l.side === 'over').map((l) => l.points);
  return { spread: median(spreadPts), total: median(totalPts) };
}

// CFB: one record from providers/cfbdProvider.js's fetchLines (per-game,
// carrying every quoted book's line). CFBD's `spread` field is the home
// team's spread with the OPPOSITE sign convention from this project
// (CFBD: negative = home favored; here: positive = home favored, see
// cfbdProvider.js's file header) — negated here so callers never have to
// remember that.
export function cfbMarketLine(gameLinesRecord) {
  const spreadPts = (gameLinesRecord?.lines ?? []).map((l) => l.spread).filter((v) => v != null).map((v) => -v);
  const totalPts = (gameLinesRecord?.lines ?? []).map((l) => l.overUnder).filter((v) => v != null);
  return { spread: median(spreadPts), total: median(totalPts) };
}

// `marketLinesByGame` is `{ "AWAY@HOME": { spread, total } }` (see
// nflMarketLine/cfbMarketLine above), keyed the same way projections are
// joined to lines elsewhere in this project. A game missing from the map,
// or with no numbers in it, is excluded — an honest "no line posted yet"
// rather than a false zero-gap read. Sorted descending by whichever of
// spread-gap/total-gap is larger for that game (`gapMarket` says which).
export function buildEdgeBoard(projections, marketLinesByGame) {
  const rows = [];
  for (const p of projections) {
    const key = `${p.away}@${p.home}`;
    const market = marketLinesByGame[key];
    if (!market) continue;
    const spreadGap = market.spread != null ? round1(Math.abs(p.projectedSpread - market.spread)) : null;
    const totalGap = market.total != null ? round1(Math.abs(p.projectedTotal - market.total)) : null;
    if (spreadGap == null && totalGap == null) continue;
    const gapMarket = (spreadGap ?? -1) >= (totalGap ?? -1) ? 'spread' : 'total';
    rows.push({
      game: key,
      projectedSpread: p.projectedSpread,
      marketSpread: market.spread ?? null,
      spreadGap,
      projectedTotal: p.projectedTotal,
      marketTotal: market.total ?? null,
      totalGap,
      gap: gapMarket === 'spread' ? spreadGap : totalGap,
      gapMarket,
    });
  }
  return rows.sort((a, b) => b.gap - a.gap);
}

function round1(v) { return Math.round(v * 10) / 10; }
