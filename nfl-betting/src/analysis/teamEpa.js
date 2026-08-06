// EPA (expected points added) per play — the single per-play efficiency
// metric the analytics community (nflfastR, PFF, Football Outsiders' modern
// work) treats as the strongest available signal, well ahead of points- or
// yards-per-game, because it credits every play for the situation it
// happened in (down, distance, field position) instead of just the outcome.
// Built from nflverse's public play-by-play data (src/providers/nflverseProvider.js
// fetchPbp) — already-computed `epa`/`success` columns from nflfastR, not
// re-derived here. Everything in this file is pure (no network), operating
// on rows already fetched by the provider — same separation as positionMatchup.js.

const SCRIMMAGE_PLAY_TYPES = new Set(['run', 'pass']);

// Aggregates play-by-play rows into an offensive and defensive EPA/play +
// success-rate split per team. Only scrimmage plays (run/pass) count —
// special teams, penalties-only, and no-plays don't carry a meaningful EPA
// value for "how well does this offense/defense play snap-to-snap."
// `throughWeek` scopes to games up to and including that week (for a
// mid-season snapshot); omit it to use every row passed in.
export function computeTeamEpaSplits(pbpRows, { seasonType = 'REG', throughWeek } = {}) {
  const splits = {};
  const ensure = (team) => {
    if (!splits[team]) splits[team] = { offEpaSum: 0, offPlays: 0, offSuccess: 0, defEpaSum: 0, defPlays: 0, defSuccess: 0 };
    return splits[team];
  };

  for (const r of pbpRows) {
    if (seasonType && r.season_type !== seasonType) continue;
    if (throughWeek != null && !(r.week <= throughWeek)) continue;
    if (!SCRIMMAGE_PLAY_TYPES.has(r.play_type)) continue;
    if (r.epa == null || !Number.isFinite(r.epa)) continue;
    if (!r.posteam || !r.defteam) continue;

    const success = r.success === 1 || r.success === '1' ? 1 : 0;

    const off = ensure(r.posteam);
    off.offEpaSum += r.epa;
    off.offPlays += 1;
    off.offSuccess += success;

    const def = ensure(r.defteam);
    def.defEpaSum += r.epa;
    def.defPlays += 1;
    def.defSuccess += success;
  }

  const result = {};
  for (const [team, s] of Object.entries(splits)) {
    result[team] = {
      offEpaPerPlay: s.offPlays ? s.offEpaSum / s.offPlays : null,
      offSuccessRate: s.offPlays ? s.offSuccess / s.offPlays : null,
      offPlays: s.offPlays,
      // Defensive EPA/play allowed — lower (more negative) is a better defense,
      // mirroring how the offensive number reads (higher is a better offense).
      defEpaPerPlay: s.defPlays ? s.defEpaSum / s.defPlays : null,
      defSuccessRate: s.defPlays ? s.defSuccess / s.defPlays : null,
      defPlays: s.defPlays,
    };
  }
  return result;
}

// League-average offensive or defensive EPA/play across every team with data
// — the zero-point a team's number should be read against (raw EPA/play is
// already roughly zero-centered league-wide, but this stays exact rather
// than assuming that holds for a partial-season slice).
export function leagueAverageEpaPerPlay(splits, side = 'off') {
  const key = side === 'off' ? 'offEpaPerPlay' : 'defEpaPerPlay';
  const values = Object.values(splits).map((s) => s[key]).filter((v) => v != null && Number.isFinite(v));
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Net EPA/play edge for the home side of a specific matchup: home's offense
// against away's defense, minus away's offense against home's defense.
// Returns null (no adjustment) rather than guessing when either side is
// missing data — e.g. a team with zero scrimmage plays recorded yet.
export function epaMatchupEdgePerPlay(home, away) {
  if (!home || !away) return null;
  if (home.offEpaPerPlay == null || away.defEpaPerPlay == null) return null;
  if (away.offEpaPerPlay == null || home.defEpaPerPlay == null) return null;
  const homeSideEpa = home.offEpaPerPlay - away.defEpaPerPlay; // home offense vs away defense
  const awaySideEpa = away.offEpaPerPlay - home.defEpaPerPlay; // away offense vs home defense
  return homeSideEpa - awaySideEpa;
}
