// Maps CFBD's raw season-stats rows + game results into the flat per-team
// stats shape matchupEngine.js expects — the CFB analogue of weeklyUpdate.js's
// mapEspnStatsToModel for the NFL side. Pure (no network) so it's testable
// against fixtures instead of live CFBD calls; see cfbEdgeBoard.js for the
// provider calls that produce the raw inputs these functions consume.

// CFBD's /stats/season returns one row per {team, statName, statValue} —
// this collapses that into { [team]: { [statName]: statValue } }.
export function groupStatsByTeam(statRows) {
  const byTeam = {};
  for (const r of statRows) {
    (byTeam[r.team] ??= {})[r.statName] = r.statValue;
  }
  return byTeam;
}

// CFBD's /stats/season has no points-for/against field, so those come from
// aggregating completed games instead (same source as fetchGames' box
// scores). Only completed games count. `throughWeek` scopes to games up to
// and including that week — for a real in-progress season this is
// redundant (future weeks aren't `completed` yet, so passing the full
// season's games is already safe), but it matters for backtesting an
// already-finished historical season: without it, "week 5" would silently
// pull in every game through the season finale (see cfbEdgeBoard.js's file
// header — same no-lookahead principle as teamEpa.js's throughWeek for NFL EPA).
export function computeTeamPointsSplits(games, team, { throughWeek } = {}) {
  const inScope = throughWeek != null ? games.filter((g) => g.week <= throughWeek) : games;
  const homeGames = inScope.filter((g) => g.completed && g.homeTeam === team);
  const awayGames = inScope.filter((g) => g.completed && g.awayTeam === team);
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return {
    homeFor: avg(homeGames.map((g) => g.homePoints)),
    homeAgainst: avg(homeGames.map((g) => g.awayPoints)),
    awayFor: avg(awayGames.map((g) => g.awayPoints)),
    awayAgainst: avg(awayGames.map((g) => g.homePoints)),
    overallFor: avg([...homeGames.map((g) => g.homePoints), ...awayGames.map((g) => g.awayPoints)]),
    overallAgainst: avg([...homeGames.map((g) => g.awayPoints), ...awayGames.map((g) => g.homePoints)]),
  };
}

// CFB averages run a bit higher than the NFL's on pace/scoring — a real,
// well-known difference (more plays/game, faster average tempo) — so these
// preseason/no-data fallbacks are CFB-specific, not copy-pasted NFL numbers.
const FALLBACK = { pointsPerGame: 24, thirdDownPct: 39, redZoneTdPct: 58, sackRate: 2.2, yardsPerPlay: 5.6, playsPerGame: 70, fourthDownAttemptRate: 1.6 };

// A team with zero completed games (preseason, or hasn't played yet this
// week) gets an all-fallback profile rather than computed zeros — 0
// sacks/game from an empty sample would otherwise read as a real signal
// instead of "no data yet."
function fallbackProfile(team) {
  return {
    abbr: team, gamesPlayed: 0,
    pointsForPerGame: FALLBACK.pointsPerGame, pointsAgainstPerGame: FALLBACK.pointsPerGame,
    homePointsForPerGame: FALLBACK.pointsPerGame, homePointsAgainstPerGame: FALLBACK.pointsPerGame,
    awayPointsForPerGame: FALLBACK.pointsPerGame, awayPointsAgainstPerGame: FALLBACK.pointsPerGame,
    passYardsPerGame: 230, rushYardsPerGame: 170,
    yardsPerPlay: FALLBACK.yardsPerPlay, playsPerGame: FALLBACK.playsPerGame,
    thirdDownPct: FALLBACK.thirdDownPct, redZoneTdPct: FALLBACK.redZoneTdPct,
    sackRate: FALLBACK.sackRate, sackRateAllowed: FALLBACK.sackRate,
    fourthDownAttemptRate: FALLBACK.fourthDownAttemptRate,
    priorSeasonPointDiffPerGame: 0,
  };
}

export function mapCfbdStatsToModel(team, statMap, pointsSplits) {
  const games = statMap?.games ?? 0;
  if (games === 0) return fallbackProfile(team);

  const passYds = statMap.netPassingYards ?? 0;
  const rushYds = statMap.rushingYards ?? 0;
  const totalYds = statMap.totalYards ?? (passYds + rushYds);
  const plays = (statMap.passAttempts ?? 0) + (statMap.rushingAttempts ?? 0);

  return {
    abbr: team,
    gamesPlayed: games,
    pointsForPerGame: pointsSplits.overallFor ?? FALLBACK.pointsPerGame,
    pointsAgainstPerGame: pointsSplits.overallAgainst ?? FALLBACK.pointsPerGame,
    homePointsForPerGame: pointsSplits.homeFor ?? pointsSplits.overallFor ?? FALLBACK.pointsPerGame,
    homePointsAgainstPerGame: pointsSplits.homeAgainst ?? pointsSplits.overallAgainst ?? FALLBACK.pointsPerGame,
    awayPointsForPerGame: pointsSplits.awayFor ?? pointsSplits.overallFor ?? FALLBACK.pointsPerGame,
    awayPointsAgainstPerGame: pointsSplits.awayAgainst ?? pointsSplits.overallAgainst ?? FALLBACK.pointsPerGame,
    passYardsPerGame: passYds / games,
    rushYardsPerGame: rushYds / games,
    yardsPerPlay: plays ? totalYds / plays : FALLBACK.yardsPerPlay,
    playsPerGame: plays ? plays / games : FALLBACK.playsPerGame,
    thirdDownPct: statMap.thirdDowns ? (statMap.thirdDownConversions / statMap.thirdDowns) * 100 : FALLBACK.thirdDownPct,
    // CFBD's /stats/season has no red-zone breakdown; league-average default
    // (same posture as weeklyUpdate.js's mapEspnStatsToModel for a missing ESPN field).
    redZoneTdPct: FALLBACK.redZoneTdPct,
    sackRate: (statMap.sacks ?? 0) / games,
    sackRateAllowed: (statMap.sacksOpponent ?? 0) / games,
    fourthDownAttemptRate: (statMap.fourthDowns ?? 0) / games,
    priorSeasonPointDiffPerGame: (pointsSplits.overallFor ?? FALLBACK.pointsPerGame) - (pointsSplits.overallAgainst ?? FALLBACK.pointsPerGame),
  };
}
