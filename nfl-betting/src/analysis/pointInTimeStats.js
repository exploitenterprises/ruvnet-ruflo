// Reconstructs "season stats as of week N" from real per-game boxscores,
// for the NFL side of the full-model backtest (nflFullBacktest.js).
// ESPN's team-statistics endpoint (statsProvider.js's fetchTeamSeasonStats)
// is always an "as of query time" aggregate — confirmed live: passing a
// `week` query param is silently ignored, it always returns the full
// season's totals — so it can't be used for a no-lookahead backtest.
// statsProvider.js's fetchGameBoxscore instead pulls each individual game's
// real boxscore; this module aggregates a list of those (already fetched
// and cached by the caller) into the same flat per-team profile shape
// weeklyUpdate.js's mapEspnStatsToModel produces, but built only from games
// that had actually been played by the cutoff week — pure, no network, so
// it's unit-testable against fixtures instead of live ESPN calls.

// ESPN's boxscore encodes some stats as "made-attempts" or "made/attempts"
// strings (e.g. thirdDownEff: "7-14", completionAttempts: "26/41") rather
// than separate numeric fields — this parses either separator.
function parseFraction(str) {
  if (!str) return { made: 0, attempts: 0 };
  const [made, attempts] = str.split(/[-/]/).map(Number);
  return { made: made || 0, attempts: attempts || 0 };
}

const FALLBACK = { pointsPerGame: 21, thirdDownPct: 39, redZoneTdPct: 58, sackRate: 2.5, yardsPerPlay: 5.4, playsPerGame: 64, fourthDownAttemptRate: 1.5 };

function fallbackProfile(abbr) {
  return {
    abbr, gamesPlayed: 0,
    pointsForPerGame: FALLBACK.pointsPerGame, pointsAgainstPerGame: FALLBACK.pointsPerGame,
    homePointsForPerGame: FALLBACK.pointsPerGame, homePointsAgainstPerGame: FALLBACK.pointsPerGame,
    awayPointsForPerGame: FALLBACK.pointsPerGame, awayPointsAgainstPerGame: FALLBACK.pointsPerGame,
    passYardsPerGame: 220, rushYardsPerGame: 110,
    yardsPerPlay: FALLBACK.yardsPerPlay, playsPerGame: FALLBACK.playsPerGame,
    thirdDownPct: FALLBACK.thirdDownPct, redZoneTdPct: FALLBACK.redZoneTdPct,
    sackRate: FALLBACK.sackRate, sackRateAllowed: FALLBACK.sackRate,
    fourthDownAttemptRate: FALLBACK.fourthDownAttemptRate,
    priorSeasonPointDiffPerGame: 0,
  };
}

// `games` is a flat array of already-fetched, already-completed games in
// the shape { week, home: { abbr, score, stats }, away: { abbr, score, stats } }
// (stats is fetchGameBoxscore's raw {statName: displayValue} map for that
// team in that specific game). Returns the same shape mapEspnStatsToModel
// produces, but built only from games where `week <= throughWeek` — the
// no-lookahead cutoff.
export function aggregateTeamStatsThroughWeek(games, team, throughWeek) {
  const played = games.filter((g) => g.week <= throughWeek && (g.home.abbr === team || g.away.abbr === team));
  if (played.length === 0) return fallbackProfile(team);

  const totals = {
    pointsFor: 0, pointsAgainst: 0, homePointsFor: 0, homePointsAgainst: 0, homeGames: 0,
    awayPointsFor: 0, awayPointsAgainst: 0, awayGames: 0,
    passYards: 0, rushYards: 0, plays: 0, thirdMade: 0, thirdAtt: 0,
    fourthAtt: 0, sacksAllowed: 0, sacksMade: 0, redZoneMade: 0, redZoneAtt: 0,
  };

  for (const g of played) {
    const isHome = g.home.abbr === team;
    const self = isHome ? g.home : g.away;
    const opp = isHome ? g.away : g.home;

    totals.pointsFor += self.score;
    totals.pointsAgainst += opp.score;
    if (isHome) { totals.homePointsFor += self.score; totals.homePointsAgainst += opp.score; totals.homeGames += 1; }
    else { totals.awayPointsFor += self.score; totals.awayPointsAgainst += opp.score; totals.awayGames += 1; }

    const s = self.stats ?? {};
    const oppStats = opp.stats ?? {};
    totals.passYards += Number(s.netPassingYards) || 0;
    totals.rushYards += Number(s.rushingYards) || 0;
    totals.plays += Number(s.totalOffensivePlays) || 0;
    const third = parseFraction(s.thirdDownEff);
    totals.thirdMade += third.made; totals.thirdAtt += third.attempts;
    const fourth = parseFraction(s.fourthDownEff);
    totals.fourthAtt += fourth.attempts;
    const redZone = parseFraction(s.redZoneAttempts);
    totals.redZoneMade += redZone.made; totals.redZoneAtt += redZone.attempts;
    // This team's own boxscore "sacksYardsLost" is sacks its offense took
    // (sacks allowed); the opponent's boxscore in the same game records the
    // sacks THIS team's defense made — the two boxscores are each other's
    // sack-rate source, not the same field read twice.
    totals.sacksAllowed += parseFraction(s.sacksYardsLost).made;
    totals.sacksMade += parseFraction(oppStats.sacksYardsLost).made;
  }

  const gamesPlayed = played.length;
  return {
    abbr: team,
    gamesPlayed,
    pointsForPerGame: totals.pointsFor / gamesPlayed,
    pointsAgainstPerGame: totals.pointsAgainst / gamesPlayed,
    homePointsForPerGame: totals.homeGames ? totals.homePointsFor / totals.homeGames : totals.pointsFor / gamesPlayed,
    homePointsAgainstPerGame: totals.homeGames ? totals.homePointsAgainst / totals.homeGames : totals.pointsAgainst / gamesPlayed,
    awayPointsForPerGame: totals.awayGames ? totals.awayPointsFor / totals.awayGames : totals.pointsFor / gamesPlayed,
    awayPointsAgainstPerGame: totals.awayGames ? totals.awayPointsAgainst / totals.awayGames : totals.pointsAgainst / gamesPlayed,
    passYardsPerGame: totals.passYards / gamesPlayed,
    rushYardsPerGame: totals.rushYards / gamesPlayed,
    yardsPerPlay: totals.plays ? (totals.passYards + totals.rushYards) / totals.plays : FALLBACK.yardsPerPlay,
    playsPerGame: totals.plays / gamesPlayed,
    thirdDownPct: totals.thirdAtt ? (totals.thirdMade / totals.thirdAtt) * 100 : FALLBACK.thirdDownPct,
    redZoneTdPct: totals.redZoneAtt ? (totals.redZoneMade / totals.redZoneAtt) * 100 : FALLBACK.redZoneTdPct,
    sackRate: totals.sacksMade / gamesPlayed,
    sackRateAllowed: totals.sacksAllowed / gamesPlayed,
    fourthDownAttemptRate: totals.fourthAtt / gamesPlayed,
    priorSeasonPointDiffPerGame: (totals.pointsFor - totals.pointsAgainst) / gamesPlayed,
  };
}
