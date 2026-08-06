export function renderWeeklyMarkdown({ season, week, source, projections, valueBets, futuresValue, generatedAt, edgeBoard = [], lineMovementNotes = [] }) {
  const lines = [];
  lines.push(`# NFL Betting Strategy — Week ${week}, ${season} Season`);
  lines.push('');
  lines.push(`_Generated ${generatedAt} · data source: ${source}_`);
  lines.push('');
  lines.push('> Model output for research purposes. Not financial advice. Bet within your means,');
  lines.push('> use fractional Kelly sizing, and never stake more than you can afford to lose.');
  lines.push('');

  lines.push('## Matchup Projections');
  lines.push('');
  lines.push('| Game | Projected Score | Spread (home) | Total | Home Win% | Notes |');
  lines.push('|---|---|---|---|---|---|');
  for (const p of projections) {
    const notes = [...p.weatherNotes, ...p.schemeNotes].join('; ');
    lines.push(`| ${p.away} @ ${p.home} | ${p.away} ${p.projectedAwayScore} – ${p.home} ${p.projectedHomeScore} | ${p.projectedSpread > 0 ? 'home -' + p.projectedSpread : 'home +' + Math.abs(p.projectedSpread)} | ${p.projectedTotal} | ${(p.homeWinProb * 100).toFixed(1)}% | ${notes || '—'} |`);
  }
  lines.push('');

  lines.push('## Model vs. Market (Edge Board)');
  lines.push('');
  lines.push('_Not picks — just what the model thinks the spread/total should be, next to what the market has, ranked by the size of the disagreement. Decide what to do with the gap yourself._');
  lines.push('');
  if (edgeBoard.length === 0) {
    lines.push('_No market lines available to compare against this run._');
  } else {
    lines.push('| Game | Model Spread | Market Spread | Gap | Model Total | Market Total | Gap |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const e of edgeBoard) {
      lines.push(`| ${e.game} | ${e.projectedSpread} | ${e.marketSpread ?? '—'} | ${e.spreadGap ?? '—'} | ${e.projectedTotal} | ${e.marketTotal ?? '—'} | ${e.totalGap ?? '—'} |`);
    }
  }
  lines.push('');

  lines.push('## Line Movement');
  lines.push('');
  lines.push('_This pipeline\'s own real market-line snapshots over time — not a paid historical-odds feed or a public bet-percentage source (both checked directly and ruled out; see analysis/lineMovement.js). A game only shows here once we\'ve seen it more than once._');
  lines.push('');
  if (lineMovementNotes.length === 0) {
    lines.push('_No notable movement yet this run — either every game is new to tracking, or nothing has moved half a point or more since first seen._');
  } else {
    for (const note of lineMovementNotes) lines.push(`- ${note}`);
  }
  lines.push('');

  lines.push('## Value Bets This Week');
  lines.push('');
  if (valueBets.length === 0) {
    lines.push('_No bets cleared the edge threshold this week — that is a valid, expected outcome most weeks._');
  } else {
    lines.push('| Game | Market | Side | Line | Book | Price | Model Prob | Edge vs Book | Edge vs Market | EV/$100 | Kelly (1/4) % of bankroll |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const v of valueBets) {
      lines.push(`| ${v.game} | ${v.market} | ${v.side} | ${v.points ?? '—'} | ${v.book} | ${v.price > 0 ? '+' + v.price : v.price} | ${(v.modelProb * 100).toFixed(1)}% | ${v.edgeVsBookPct}% | ${v.edgeVsMarketPct != null ? v.edgeVsMarketPct + '%' : '—'} | $${v.expectedValuePer100} | ${v.kellyStakePct}% |`);
    }
  }
  lines.push('');

  lines.push('## Futures Value');
  lines.push('');
  if (futuresValue.length === 0) {
    lines.push('_No futures edges cleared threshold this run._');
  } else {
    lines.push('| Market | Team | Price | Model Prob | Market Fair Prob | Edge |');
    lines.push('|---|---|---|---|---|---|');
    for (const f of futuresValue) {
      lines.push(`| ${f.market} | ${f.team} | ${f.price > 0 ? '+' + f.price : f.price} | ${(f.modelProb * 100).toFixed(1)}% | ${(f.marketFairProb * 100).toFixed(1)}% | ${f.edgePct}% |`);
    }
  }
  lines.push('');

  return lines.join('\n');
}
