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
// v1 gaps (weather, EPA, starter injuries) closed — see the corresponding
// value-add-not-hard-dependency wiring below, same posture as weeklyUpdate.js's
// live NFL path: a provider failure degrades that one signal to "no data,"
// never fails the whole board.
// - Weather: CFBD's /teams/fbs `location` field carries real per-stadium
//   lat/lon/dome (confirmed live, e.g. Ohio Stadium 40.0016/-83.0197,
//   dome: false) — no hand-curated CFB stadium dataset needed.
// - EPA: CFBD's /stats/season/advanced offense.ppa/defense.ppa is the CFB
//   analogue of nflfastR's EPA/play (see analysis/cfbStats.js's
//   mapCfbdAdvancedToEpaSplits for the direct-inspection confirmation).
// - Starter injuries: ESPN's college-football depth-chart endpoint has the
//   identical shape to the NFL one, just a different base URL and team-id
//   space (see providers/injuryProvider.js's fetchCfbTeamDepthChart). Joined
//   to CFBD's school names via ESPN's `location` field — confirmed live:
//   all 136 CFBD FBS schools match an ESPN `location` exactly.
// - Uses CFBD's own Elo ratings directly (real, established, covers all 136
//   FBS teams — see providers/cfbdProvider.js's fetchEloRatings) rather than
//   a from-scratch CFB Elo engine. cfbEloBacktest.js caught a real -2.4pt
//   spread bias using the NFL's Elo-to-points constant (25 pts/margin-pt);
//   investigated whether CFB needs a different constant and, after
//   correcting a regression-direction mistake in the first attempt (see
//   powerRatings.js's CFB_ELO_POINTS_PER_MARGIN for the full derivation),
//   found the constant barely matters — 23 vs 25 give statistically
//   identical MAE across 1514 real games. Using 23 as the
//   empirically-verified best single value, but this is a minor
//   correction, not a real fix for the underlying bias (source unclear —
//   worth another look once the full-model backtest exists).
// - Points-for/against (computeTeamPointsSplits) and CFBD's /stats/season
//   counting stats (pass/rush yards, sacks, third-down rate) are used
//   consistently "as of query time," not week-scoped, for a real
//   in-progress week — correct by construction (future games simply
//   aren't `completed` yet, so there's nothing to leak), and simpler than
//   passing a redundant startWeek/endWeek on every live call. CORRECTION to
//   an earlier version of this comment: /stats/season and
//   /stats/season/advanced DO support genuine week-scoping via
//   startWeek/endWeek params (confirmed live: Air Force's `games` stat was
//   4 for weeks 1-5 vs. 12 full-season) — this was wrongly assumed
//   unsupported when EPA was first wired in. That's what makes
//   cfbFullBacktest.js possible without per-game box-score reconstruction
//   (contrast the NFL side's nflFullBacktest.js, which needs exactly that
//   reconstruction because ESPN's equivalent endpoint really does ignore a
//   week filter). Verified live against real 2025 data — market lines join
//   correctly and projections compute without crashing.

import { computeLeagueAverages } from './analysis/leagueAverages.js';
import { projectGame } from './analysis/matchupEngine.js';
import { CONSTANTS as ELO_CONSTANTS } from './analysis/powerRatings.js';
import { buildEdgeBoard, cfbMarketLine } from './analysis/edgeBoard.js';
import { groupStatsByTeam, computeTeamPointsSplits, mapCfbdStatsToModel, mapCfbdAdvancedToEpaSplits } from './analysis/cfbStats.js';
import { recordSnapshot, computeMovement, describeMovement } from './analysis/lineMovement.js';
import { loadCfbLineHistory, saveCfbLineHistory } from './lineHistoryStore.js';

export async function buildCfbEdgeBoard(season, week) {
  const cfbdProvider = await import('./providers/cfbdProvider.js');
  const weatherProvider = await import('./providers/weatherProvider.js');
  const injuryProvider = await import('./providers/injuryProvider.js');

  const [statRows, eloRows, allGames, lineRecords, fbsTeams] = await Promise.all([
    cfbdProvider.fetchSeasonStats(season),
    cfbdProvider.fetchEloRatings(season),
    cfbdProvider.fetchGames(season), // full season so far — points-for/against needs every completed game, not just this week's
    cfbdProvider.fetchLines(season, { week }),
    cfbdProvider.fetchFbsTeams(season),
  ]);
  const stadiumByTeam = Object.fromEntries(fbsTeams.filter((t) => t.location).map((t) => [t.school, t.location]));

  // EPA is a value-add on top of the core projection, not a hard dependency
  // — same posture as weeklyUpdate.js's nflverse EPA wiring: if CFBD's
  // advanced-stats endpoint is unreachable, degrade to the pre-EPA blend
  // rather than failing the whole board.
  let epaSplitsByTeam = {};
  try {
    const advancedRows = await cfbdProvider.fetchAdvancedTeamStats(season);
    epaSplitsByTeam = mapCfbdAdvancedToEpaSplits(advancedRows);
  } catch {
    epaSplitsByTeam = {};
  }

  // Starter-availability signal — same value-add-not-hard-dependency posture:
  // a lookup-table or per-team depth-chart failure degrades that one team to
  // "no injury data" (matchupEngine.js treats a missing depth chart as no
  // adjustment) rather than failing the whole board.
  let espnIdBySchool = {};
  try {
    espnIdBySchool = await injuryProvider.fetchCfbTeamIdsBySchool();
  } catch {
    espnIdBySchool = {};
  }
  const depthChartCache = {};
  async function getDepthChart(school) {
    if (school in depthChartCache) return depthChartCache[school];
    let dc = null;
    try {
      const espnId = espnIdBySchool[school];
      dc = espnId ? await injuryProvider.fetchCfbTeamDepthChart(espnId) : null;
    } catch {
      dc = null;
    }
    depthChartCache[school] = dc;
    return dc;
  }

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

    // Weather: skip entirely for a dome/unknown-venue home stadium or a
    // neutral-site game (the home team's own stadium coords don't apply —
    // same conservative "no adjustment" default weeklyUpdate.js uses for an
    // unrecognized NFL stadium).
    const stadium = stadiumByTeam[g.homeTeam];
    let weather = { isDome: true };
    if (!g.neutralSite && stadium && !stadium.dome && stadium.lat != null && stadium.lon != null) {
      try {
        weather = await weatherProvider.fetchGameWeather({ lat: stadium.lat, lon: stadium.lon, kickoffIso: g.startDate });
      } catch (err) {
        weather = { isDome: false, note: `weather fetch failed: ${err.message}` };
      }
    }

    const [homeDepthChart, awayDepthChart] = await Promise.all([getDepthChart(g.homeTeam), getDepthChart(g.awayTeam)]);

    projections.push(projectGame({
      home: { abbr: g.homeTeam, stats: seasonStats[g.homeTeam], rating: eloByTeam[g.homeTeam] ?? 1500 },
      away: { abbr: g.awayTeam, stats: seasonStats[g.awayTeam], rating: eloByTeam[g.awayTeam] ?? 1500 },
      leagueAvg,
      neutralSite: g.neutralSite,
      eloPointsPerMargin: ELO_CONSTANTS.CFB_ELO_POINTS_PER_MARGIN,
      weather,
      epaSplits: { home: epaSplitsByTeam[g.homeTeam], away: epaSplitsByTeam[g.awayTeam] },
      injuries: { home: homeDepthChart, away: awayDepthChart },
    }));
  }

  const marketLinesByGame = {};
  for (const record of lineRecords) {
    marketLinesByGame[`${record.awayTeam}@${record.homeTeam}`] = cfbMarketLine(record);
  }

  // Line movement: same self-collected approach as the NFL side (see
  // analysis/lineMovement.js for why) — this pipeline's own real market-line
  // pulls, snapshotted over time.
  const generatedAt = new Date().toISOString();
  let lineHistory = await loadCfbLineHistory();
  for (const [key, line] of Object.entries(marketLinesByGame)) {
    lineHistory = recordSnapshot(lineHistory, key, line, generatedAt);
  }
  await saveCfbLineHistory(lineHistory);
  const lineMovementNotes = Object.keys(marketLinesByGame)
    .flatMap((key) => describeMovement(key, computeMovement(lineHistory, key)));

  return { edgeBoard: buildEdgeBoard(projections, marketLinesByGame), lineMovementNotes };
}
