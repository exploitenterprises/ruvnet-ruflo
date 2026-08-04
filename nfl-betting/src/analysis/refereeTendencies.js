// Referee-crew tendency signal — how many penalties/penalty yards a given
// head referee's games tend to have relative to league average, computed
// from real historical data (nflverse's officials.csv.gz joined to its
// play-by-play). See providers/nflverseProvider.js's fetchOfficials for the
// honest scope limit this whole signal has: it's a lookup against PAST
// games, since crew assignments for an upcoming game aren't announced until
// a few days before kickoff — not a standard week-ahead pipeline input like
// EPA or injuries. Surfaced as an informational note only (matchupEngine.js),
// never a point adjustment.
//
// Scope: penalties/penalty yards only. "This ref's games run high-scoring"
// is a commonly cited betting angle too, but the effect size is noisier and
// less directly attributable to the crew than penalty-calling is — left out
// rather than overstating confidence in a number this file can't back up as well.

// One row per {game_id: {penalties, penaltyYards}} — game-level penalty
// totals from play-by-play, the join target for per-referee aggregation
// below. `old_game_id` is pbp's legacy numeric GSIS id, the same id space
// officials.csv.gz's `game_id` column uses (confirmed by direct join test —
// pbp's own `game_id` field is a different, season_week_away_home format).
export function summarizePenaltiesByGame(pbpRows) {
  const byGame = {};
  for (const r of pbpRows) {
    const gid = r.old_game_id;
    if (!gid) continue;
    const g = (byGame[gid] ??= { penalties: 0, penaltyYards: 0 });
    if (r.penalty === 1) {
      g.penalties += 1;
      g.penaltyYards += r.penalty_yards ?? 0;
    }
  }
  return byGame;
}

// Averages penalties/penalty-yards per game across every game a given
// referee (crew chief — position === 'Referee') worked, joining officials
// rows to the game-level penalty summary above by game_id.
export function computeRefereeTendencies(officialsRows, gameSummaries) {
  const byReferee = {};
  for (const o of officialsRows) {
    if (o.position !== 'Referee') continue;
    const summary = gameSummaries[o.game_id];
    if (!summary) continue;
    const r = (byReferee[o.official_name] ??= { penaltiesSum: 0, penaltyYardsSum: 0, games: 0 });
    r.penaltiesSum += summary.penalties;
    r.penaltyYardsSum += summary.penaltyYards;
    r.games += 1;
  }
  const result = {};
  for (const [name, r] of Object.entries(byReferee)) {
    result[name] = {
      games: r.games,
      penaltiesPerGame: r.penaltiesSum / r.games,
      penaltyYardsPerGame: r.penaltyYardsSum / r.games,
    };
  }
  return result;
}

// League-average penalties/game across every referee with data — what an
// individual referee's number should be read against.
export function leagueAveragePenaltiesPerGame(refereeTendencies) {
  const values = Object.values(refereeTendencies).map((r) => r.penaltiesPerGame).filter((v) => Number.isFinite(v));
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// >1 = calls more penalties than league average, <1 = fewer — same "ratio
// family" as schemeTendencies/positionMatchup for consistency, even though
// this one is surfaced as an informational note only (see matchupEngine.js),
// never a point adjustment.
export function refereePenaltyRatio(refereeTendency, leagueAvgPenaltiesPerGame) {
  if (!refereeTendency || !leagueAvgPenaltiesPerGame) return null;
  return refereeTendency.penaltiesPerGame / leagueAvgPenaltiesPerGame;
}
