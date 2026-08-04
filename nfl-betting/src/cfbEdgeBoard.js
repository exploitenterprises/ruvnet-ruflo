// CFB analogue of weeklyUpdate.js's live NFL path — but scoped specifically
// to producing the model-vs-market edge board (analysis/edgeBoard.js), not
// a full weekly report/ledger/futures pipeline like the NFL side has. That
// scope was a deliberate choice, not a shortcut: this is what was actually
// asked for ("what you think the spread/total should be vs. the market,
// ranked by gap — not picks"), and building a full parallel CFB report
// system wasn't.
//
// Reuses matchupEngine.js as-is — it only cares about the {abbr, stats,
// rating} shape, not which sport the numbers came from.
//
// Stated v1 gaps (extend the same way the NFL side's signals were added
// incrementally — EPA, then starter injuries):
// - No weather adjustment (no CFB stadium/lat-lon dataset built yet).
// - No EPA signal (CFBD's advanced stats have a PPA/EPA-equivalent, not yet
//   wired into teamEpa.js's shape — that module is nflverse-pbp-specific).
// - No starter-injury signal (ESPN's depth-chart endpoint uses a different
//   base URL for college-football, not yet wired — see injuryProvider.js).
// - Uses CFBD's own Elo ratings directly (real, established, covers all 136
//   FBS teams — see providers/cfbdProvider.js's fetchEloRatings) rather than
//   a from-scratch CFB Elo engine, but matchupEngine's Elo-to-points
//   conversion constant (powerRatings.js's winProbToSpread, 25 Elo points
//   per point of margin) is NFL-calibrated — a known approximation for CFB,
//   not a recalibrated one.
// - Points-for/against (computeTeamPointsSplits) and CFBD's /stats/season
//   counting stats (pass/rush yards, sacks, third-down rate) are used
//   consistently "as of query time," not week-scoped. For a real
//   in-progress season this is correct by construction (future games
//   simply aren't `completed` yet, so there's nothing to leak). It matters
//   only when backtesting an already-finished historical season, where both
//   halves will reflect full-season rates rather than a true
//   through-week-N snapshot — tried partially week-scoping just the points
//   half for that case and it made projections measurably worse (median
//   model-vs-market gap roughly doubled) by decoupling it from the
//   still-full-season rate stats it's blended with; consistency between the
//   two matters more than a partial fix. computeTeamPointsSplits's
//   throughWeek option is kept for if/when a week-scoped stats source is
//   added for both halves. Verified live against real 2025 data — market
//   lines join correctly and projections compute without crashing, though
//   the historical-backtest lookahead caveat above means the gap sizes seen
//   there shouldn't be read as validation of real predictive accuracy.

import { computeLeagueAverages } from './analysis/leagueAverages.js';
import { projectGame } from './analysis/matchupEngine.js';
import { buildEdgeBoard, cfbMarketLine } from './analysis/edgeBoard.js';
import { groupStatsByTeam, computeTeamPointsSplits, mapCfbdStatsToModel } from './analysis/cfbStats.js';

export async function buildCfbEdgeBoard(season, week) {
  const cfbdProvider = await import('./providers/cfbdProvider.js');

  const [statRows, eloRows, allGames, lineRecords] = await Promise.all([
    cfbdProvider.fetchSeasonStats(season),
    cfbdProvider.fetchEloRatings(season),
    cfbdProvider.fetchGames(season), // full season so far — points-for/against needs every completed game, not just this week's
    cfbdProvider.fetchLines(season, { week }),
  ]);

  const statsByTeam = groupStatsByTeam(statRows);
  const eloByTeam = Object.fromEntries(eloRows.map((r) => [r.team, r.elo]));
  const slate = allGames.filter((g) => g.week === week);

  const seasonStats = {};
  for (const team of Object.keys(statsByTeam)) {
    // Deliberately NOT week-scoped here (see file header): CFBD's
    // /stats/season counting stats have no week granularity at all, so
    // scoping only the points-for/against half would decouple it from the
    // pass/rush/sack rates it's blended with in matchupEngine — verified
    // live that this produces materially worse (internally inconsistent)
    // projections than using both consistently "as of query time." For a
    // real in-progress season both halves are already correctly scoped by
    // definition (future games aren't `completed` yet); computeTeamPointsSplits's
    // throughWeek option stays available for when a week-scoped stats
    // source is added.
    const pointsSplits = computeTeamPointsSplits(allGames, team);
    seasonStats[team] = mapCfbdStatsToModel(team, statsByTeam[team], pointsSplits);
  }
  const leagueAvg = computeLeagueAverages(Object.values(seasonStats));

  const projections = [];
  for (const g of slate) {
    // A game against a non-FBS opponent (or missing season-stats row for
    // some other reason) can't be projected — skipped rather than faked
    // with a league-average stand-in for a team we have no real data on.
    if (!seasonStats[g.homeTeam] || !seasonStats[g.awayTeam]) continue;
    projections.push(projectGame({
      home: { abbr: g.homeTeam, stats: seasonStats[g.homeTeam], rating: eloByTeam[g.homeTeam] ?? 1500 },
      away: { abbr: g.awayTeam, stats: seasonStats[g.awayTeam], rating: eloByTeam[g.awayTeam] ?? 1500 },
      leagueAvg,
      neutralSite: g.neutralSite,
    }));
  }

  const marketLinesByGame = {};
  for (const record of lineRecords) {
    marketLinesByGame[`${record.awayTeam}@${record.homeTeam}`] = cfbMarketLine(record);
  }

  return buildEdgeBoard(projections, marketLinesByGame);
}
