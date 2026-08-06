// Head-to-head and division/rivalry trend history — straight-up always,
// against-the-spread (ATS) whenever a closing spread is available for that
// game. Built from data already gathered elsewhere in this project (game
// results from statsProvider.js/cfbdProvider.js's fetchGames, plus spread
// data from lines providers where available) — no new external source
// needed. Pure (no network), operating on rows already fetched.
//
// Honest scope limit, checked directly rather than assumed: a genuinely
// free historical closing-spread source exists for CFB — CFBD's own
// /lines endpoint returns real historical lines for past weeks/seasons
// (confirmed by direct use backtesting cfbEdgeBoard.js) — but not for NFL.
// ESPN's public boxscore/summary endpoint's pickcenter/odds/
// againstTheSpread fields were checked against real completed games and
// come back empty every time — it doesn't retain closing lines once a game
// is over — and The Odds API's historical-odds endpoint is paid-tier only
// (same finding as lineMovement.js). So NFL head-to-head/division trends
// here are straight-up only (real, free, useful on its own); CFB gets true
// ATS whenever the caller supplies spread data per game.

// One row per completed game: { season, week, homeTeam, awayTeam, homeScore,
// awayScore, homeSpread (optional) }. `homeSpread` follows this project's
// convention throughout (matchupEngine's projectedSpread, edgeBoard's
// market lines): positive = home favored by that many points.

// Straight-up + (when spread data is present) ATS record between two
// specific teams. Filter to the two teams' games before calling — this
// doesn't know which games are relevant, just summarizes whatever it's given.
export function headToHeadRecord(games, teamA, teamB) {
  const matchups = games.filter((g) =>
    (g.homeTeam === teamA && g.awayTeam === teamB) || (g.homeTeam === teamB && g.awayTeam === teamA));
  return summarizeGames(matchups, teamA);
}

// Same summary, scoped to every game a team played against a given set of
// opponents (e.g. its division or conference rivals) — this module doesn't
// know sport-specific division structure, the caller supplies the opponent list.
export function divisionTrend(games, team, divisionOpponents) {
  const opponents = new Set(divisionOpponents);
  const matchups = games.filter((g) =>
    (g.homeTeam === team && opponents.has(g.awayTeam)) ||
    (g.awayTeam === team && opponents.has(g.homeTeam)));
  return summarizeGames(matchups, team);
}

function summarizeGames(games, team) {
  let wins = 0, losses = 0, ties = 0, pointDiffSum = 0;
  let atsWins = 0, atsLosses = 0, atsPushes = 0;

  for (const g of games) {
    const isHome = g.homeTeam === team;
    const teamScore = isHome ? g.homeScore : g.awayScore;
    const oppScore = isHome ? g.awayScore : g.homeScore;
    if (teamScore == null || oppScore == null) continue;

    const margin = teamScore - oppScore;
    pointDiffSum += margin;
    if (margin > 0) wins++;
    else if (margin < 0) losses++;
    else ties++;

    if (g.homeSpread != null) {
      // Cover condition, derived from this project's "positive = home
      // favored" spread convention: home covers when its actual margin
      // beats the projected/market margin; away covers on the mirror image.
      const coverMargin = isHome ? margin - g.homeSpread : margin + g.homeSpread;
      if (coverMargin > 0) atsWins++;
      else if (coverMargin < 0) atsLosses++;
      else atsPushes++;
    }
  }

  const gamesPlayed = wins + losses + ties;
  const atsGames = atsWins + atsLosses + atsPushes;
  return {
    gamesPlayed,
    record: `${wins}-${losses}${ties ? `-${ties}` : ''}`,
    avgPointDiff: gamesPlayed ? round1(pointDiffSum / gamesPlayed) : null,
    ats: atsGames === 0 ? null : {
      record: `${atsWins}-${atsLosses}${atsPushes ? `-${atsPushes}` : ''}`,
      coverPct: atsWins + atsLosses > 0 ? round1((atsWins / (atsWins + atsLosses)) * 100) : null,
      gamesWithSpreadData: atsGames,
    },
  };
}

function round1(v) { return Math.round(v * 10) / 10; }
