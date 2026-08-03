// Next Gen Stats position-group matchup signal, built from nflverse NGS data
// (src/providers/nflverseProvider.js) and weighted toward recent seasons —
// per the explicit ask: "take into account Next Gen Stats for matchups
// position wise, use historical relevance from prior years."
//
// Honest scope limit: NGS only tracks the OFFENSIVE skill positions (QB
// passing, RB rushing, WR/TE receiving) — there is no free public
// defensive-player tracking data (coverage grades, separation allowed by a
// specific CB, etc.). So this module characterizes a team's offensive
// position-group *strength and trend*, and compares it against the
// opponent's points-allowed-based defensive proxy from team stats — it does
// NOT claim to model "this WR corps vs. this specific CB" the way real
// coverage-tracking data would. Every function here is pure (no network),
// operating on rows already fetched by nflverseProvider.js.

// Recency-weighted blend across seasons. `seasonValues` is [{season, value}],
// most recent first is NOT required — this sorts internally. `weights` are
// applied most-recent-first and renormalized to whatever's available (e.g. a
// team with only 2 seasons of a metric still gets a sensible blend instead
// of a crash or a silently wrong average).
export function computeWeightedHistory(seasonValues, weights = [0.5, 0.3, 0.2]) {
  const clean = seasonValues.filter((sv) => sv.value != null && Number.isFinite(sv.value));
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => b.season - a.season);
  const used = sorted.slice(0, weights.length);
  const w = weights.slice(0, used.length);
  const total = w.reduce((s, x) => s + x, 0);
  const normalized = w.map((x) => x / total);
  return used.reduce((sum, sv, i) => sum + sv.value * normalized[i], 0);
}

// Averages a single metric for one team/position/season out of raw NGS rows
// (player-season granularity) — a simple unweighted mean across the team's
// rostered players at that position for that season. Season-long rows only
// (week === 0) unless the caller passes rows already filtered otherwise.
export function aggregateByTeamPosition(ngsRows, { team, position, season, metric }) {
  const rows = ngsRows.filter((r) =>
    r.team_abbr === team &&
    r.player_position === position &&
    r.season === season &&
    (r.week === 0 || r.week == null) &&
    r[metric] != null);
  if (rows.length === 0) return null;
  return rows.reduce((sum, r) => sum + r[metric], 0) / rows.length;
}

// Combines the above into one historically-weighted index per team/position/metric.
export function teamPositionIndex(ngsRows, { team, position, seasons, metric, weights }) {
  const seasonValues = seasons.map((season) => ({
    season,
    value: aggregateByTeamPosition(ngsRows, { team, position, season, metric }),
  }));
  return computeWeightedHistory(seasonValues, weights);
}

// League-average index for the same metric/position/seasons, used to turn a
// raw index into a >1 = above-average / <1 = below-average ratio the same
// way schemeTendencies.js does for pace/pass-rush.
export function leaguePositionIndex(ngsRows, { position, seasons, metric, weights }) {
  const teams = [...new Set(ngsRows.filter((r) => r.player_position === position).map((r) => r.team_abbr))];
  const perTeam = teams
    .map((team) => teamPositionIndex(ngsRows, { team, position, seasons, metric, weights }))
    .filter((v) => v != null);
  if (perTeam.length === 0) return null;
  return perTeam.reduce((s, v) => s + v, 0) / perTeam.length;
}

// Mismatch signal: offense's historically-weighted position-group index vs.
// the opponent's points-allowed proxy (defAllowedRatio, from team stats —
// e.g. away.stats.pointsAgainstPerGame / leagueAvg.pointsAgainstPerGame for
// the relevant side of the ball). Returns a ratio >1 favoring the offense,
// <1 favoring the defense, in the same "multiplier" family as
// schemeTendencies.passRushMismatch so it can be composed the same way.
export function positionMatchupEdge(offenseIndexRatio, defAllowedRatio) {
  if (offenseIndexRatio == null || defAllowedRatio == null) return null;
  return offenseIndexRatio * defAllowedRatio;
}

// Convenience wrapper: builds a >1-above-average / <1-below-average ratio
// for one team/position/metric against the league, using recency weighting.
export function teamPositionRatio(ngsRows, { team, position, seasons, metric, weights }) {
  const teamIndex = teamPositionIndex(ngsRows, { team, position, seasons, metric, weights });
  const leagueIndex = leaguePositionIndex(ngsRows, { position, seasons, metric, weights });
  if (teamIndex == null || leagueIndex == null || leagueIndex === 0) return null;
  return teamIndex / leagueIndex;
}
