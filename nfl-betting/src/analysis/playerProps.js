// Player-prop projections: opponent-adjusted point-in-time rate projections
// for the stat categories real prop markets actually offer (passing/rushing/
// receiving yards, receptions). Same ratio-adjustment shape as
// matchupEngine.js's unitAdjustedPoints (player's own rate x opponent-allowed
// factor relative to league average) — deliberately reusing that pattern
// rather than inventing a new one.
//
// Built entirely from nflverse's weekly NGS files (providers/nflverseProvider.js's
// fetchNgsPassing/fetchNgsRushing/fetchNgsReceiving — already have real
// per-game rows with a `week` column, confirmed live) plus play-by-play's
// `game_id` (format "SEASON_WEEK_AWAY_HOME") to derive each team's weekly
// opponent — no new data source needed, no separate schedule endpoint call.
//
// Real bug found and fixed here (same class as statsProvider.js's WAS/WSH
// fix): nflverse's play-by-play uses "LA" for the Rams (posteam/defteam and
// game_id), but the NGS files use "LAR" — confirmed live, the only mismatch
// across all 32 teams in both datasets. Left uncorrected, every Rams game's
// opponent-allowed attribution would silently fail to join. Canonicalized
// once here, at the schedule-derivation source.
const PBP_ABBR_TO_CANONICAL = { LA: 'LAR' };
function canonicalAbbr(abbr) {
  return PBP_ABBR_TO_CANONICAL[abbr] ?? abbr;
}

// Parses nflverse pbp's `game_id`s ("2024_05_ARI_SF") into a
// { [week]: { [team]: opponent } } schedule map — real per-week matchups,
// not a hand-maintained table. `gameIds` can have duplicates (one per play);
// dedupes internally.
export function buildOpponentSchedule(gameIds) {
  const schedule = {};
  for (const id of new Set(gameIds)) {
    const parts = id.split('_');
    if (parts.length !== 4) continue;
    const week = Number(parts[1]);
    const away = canonicalAbbr(parts[2]);
    const home = canonicalAbbr(parts[3]);
    if (!week || !away || !home) continue;
    (schedule[week] ??= {})[home] = away;
    schedule[week][away] = home;
  }
  return schedule;
}

// A player's own trailing average for one stat field, using only games
// through `throughWeek` (no lookahead) — the point-in-time input to a
// projection for week `throughWeek + 1`. `rows` is a full NGS file's rows
// (any position/team); filtered here to one player.
export function aggregatePlayerRateThroughWeek(rows, playerId, statField, throughWeek) {
  const played = rows.filter((r) => r.player_gsis_id === playerId && r.week <= throughWeek);
  if (played.length === 0) return null;
  const sum = played.reduce((s, r) => s + (Number(r[statField]) || 0), 0);
  return { gamesPlayed: played.length, avgPerGame: sum / played.length };
}

// Per-defense average allowed-per-game for one stat field, through
// `throughWeek` — attributes each offensive player-week's output to the
// DEFENSE that allowed it (via the opponent schedule), summed per game
// (a defense faces multiple contributing players in the same game) then
// averaged across games. `rows` can be pre-filtered to a position group
// (e.g. only WR rows) for a position-specific allowed rate — the function
// itself doesn't care, it just aggregates whatever rows it's given.
// Returns { [defenseTeam]: { avgAllowedPerGame, games } } — `games` (the
// defense's own real sample size) is what shrinkDefenseRates needs.
export function computeDefenseAllowedPerGame(rows, statField, schedule, throughWeek) {
  const perTeamWeek = {}; // `${defTeam}|${week}` -> summed amount allowed that game
  for (const r of rows) {
    if (r.week > throughWeek) continue;
    const defTeam = schedule[r.week]?.[r.team_abbr];
    if (!defTeam) continue;
    const key = `${defTeam}|${r.week}`;
    perTeamWeek[key] = (perTeamWeek[key] ?? 0) + (Number(r[statField]) || 0);
  }
  const sums = {}, games = {};
  for (const [key, amount] of Object.entries(perTeamWeek)) {
    const defTeam = key.split('|')[0];
    sums[defTeam] = (sums[defTeam] ?? 0) + amount;
    games[defTeam] = (games[defTeam] ?? 0) + 1;
  }
  const result = {};
  for (const team of Object.keys(sums)) result[team] = { avgAllowedPerGame: sums[team] / games[team], games: games[team] };
  return result;
}

// League-average allowed-per-game across every defense with data — the
// zero-adjustment baseline an individual defense's allowed rate is read
// against (mirrors leagueAverages.js's role for team-level projections).
export function leagueAverageAllowedPerGame(defenseAllowedPerGame) {
  const values = Object.values(defenseAllowedPerGame).map((v) => v.avgAllowedPerGame);
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// Regresses each defense's allowed rate toward the league average based on
// its own real sample size — a defense's rate after 3 games is far less
// reliable than after 10, but computeDefenseAllowedPerGame alone treats
// both as equally trustworthy. `priorGames` is how many "games worth" of
// league-average belief to blend in: a defense with `priorGames` real
// games gets pulled halfway to league average; more real games dilutes
// the prior's influence, matching the standard empirical-Bayes shrinkage
// shape (same idea as regressToMean in powerRatings.js, applied here to a
// rate instead of a rating). `priorGames: 0` is a no-op (returns the raw
// rates unchanged) — the default everywhere except position-split
// receiving categories, which needed it once splitting by position cut
// each bucket's sample size (see playerPropsTuneWeight.js).
export function shrinkDefenseRates(defenseAllowedPerGame, leagueAvg, priorGames) {
  if (leagueAvg == null) return {};
  const shrunk = {};
  for (const [team, { avgAllowedPerGame, games }] of Object.entries(defenseAllowedPerGame)) {
    shrunk[team] = shrinkRate(avgAllowedPerGame, games, leagueAvg, priorGames);
  }
  return shrunk;
}

// Single-value version of the same shrinkage math — used when scoring
// already-fetched per-game records one at a time (playerPropsBacktest.js's
// scoreCategoryGames) rather than a whole team-keyed map at once.
export function shrinkRate(avgAllowedPerGame, games, leagueAvg, priorGames) {
  if (leagueAvg == null) return avgAllowedPerGame;
  return priorGames > 0 ? (games * avgAllowedPerGame + priorGames * leagueAvg) / (games + priorGames) : avgAllowedPerGame;
}

// The projection itself: player's own rate, blended toward the full
// opponent-adjusted ratio by `matchupWeight` (0 = ignore the matchup
// entirely, just the player's own rate; 1 = the original full-ratio
// adjustment; values in between interpolate). Added after backtesting
// found the full ratio (weight 1, the only option before this) mostly hurt
// accuracy vs. a naive own-rate-only baseline in 7 of 8 category/season
// combos — see playerPropsTuneWeight.js and
// reports/backtest-player-props-2025-08-06.md's "Weight tuning" section
// for the real per-category weights that search found. Degrades
// gracefully — real data or a documented no-op, never a fabricated
// number: no player rate at all -> null (nothing to project, e.g. a
// player with zero games so far); missing/unknown opponent-defense data
// (early season, insufficient sample) -> falls back to the player's own
// rate unadjusted regardless of `matchupWeight`, same "no data yet, no
// adjustment" posture as matchupEngine.js's dome/no-weather default.
export function projectPlayerStat({ playerRate, opponentAllowedPerGame, leagueAvgAllowedPerGame, matchupWeight = 1 }) {
  if (!playerRate) return null;
  if (opponentAllowedPerGame == null || leagueAvgAllowedPerGame == null || leagueAvgAllowedPerGame === 0) {
    return { projected: round1(playerRate.avgPerGame), matchupFactor: null };
  }
  const matchupFactor = opponentAllowedPerGame / leagueAvgAllowedPerGame;
  const blendedFactor = 1 + matchupWeight * (matchupFactor - 1);
  return { projected: round1(playerRate.avgPerGame * blendedFactor), matchupFactor: round3(matchupFactor) };
}

function round1(v) { return Math.round(v * 10) / 10; }
function round3(v) { return Math.round(v * 1000) / 1000; }

// --- Usage-trend model (receiving yards/receptions) ---
// After the opponent-defense adjustment (projectPlayerStat above) and its
// position-split follow-up both found no usable signal for receiving
// yards/receptions (see reports/backtest-player-props-2025-08-06.md), this
// tests a genuinely different hypothesis instead of re-slicing the same
// one: usage volume (targets) shifting recently — a role change, a hot
// streak earning more snaps, an injury elsewhere on the offense — is a
// leading indicator a flat season-long average can't see, even though the
// season-long average IS the more statistically reliable number for
// "usual" volume. Decomposes into usage x efficiency (targets x
// yards-per-target, or targets x catch-rate) rather than projecting the
// compound stat directly — yards-per-target and catch-rate are read as
// season-long ratios (stabler than a per-game average), while the targets
// side blends toward a shorter recent window.

// A player's own average for one stat field over just the last
// `windowGames` games at or before `throughWeek` (most recent first) — the
// "recent form" input a trend signal needs, as opposed to
// aggregatePlayerRateThroughWeek's full-season average.
export function aggregatePlayerRateOverWindow(rows, playerId, statField, throughWeek, windowGames) {
  const played = rows
    .filter((r) => r.player_gsis_id === playerId && r.week <= throughWeek)
    .sort((a, b) => b.week - a.week)
    .slice(0, windowGames);
  if (played.length === 0) return null;
  const sum = played.reduce((s, r) => s + (Number(r[statField]) || 0), 0);
  return { gamesPlayed: played.length, avgPerGame: sum / played.length };
}

// A player's own efficiency ratio (e.g. yards per target, or receptions
// per target = catch rate) through `throughWeek` — sum-of-numerator over
// sum-of-denominator across real games, not an average-of-per-game-ratios
// (which would let a low-volume game's noisy ratio count as much as a
// high-volume one). Null when the player has no games, or the denominator
// is always zero (nothing to divide by — e.g. zero targets all season).
export function computePlayerEfficiency(rows, playerId, numeratorField, denominatorField, throughWeek) {
  const played = rows.filter((r) => r.player_gsis_id === playerId && r.week <= throughWeek);
  if (played.length === 0) return null;
  const numSum = played.reduce((s, r) => s + (Number(r[numeratorField]) || 0), 0);
  const denomSum = played.reduce((s, r) => s + (Number(r[denominatorField]) || 0), 0);
  if (denomSum === 0) return null;
  return numSum / denomSum;
}

// The usage-trend projection: blends season-long usage volume toward a
// shorter recent-window usage rate by `usageTrendWeight` (0 = pure
// season-long usage — algebraically identical to the plain season average
// of the target stat itself, see the note in playerPropsBacktest.js; 1 =
// pure recent-window usage), then multiplies by the season-long efficiency
// ratio. Degrades gracefully: no season usage rate or no efficiency number
// at all -> null (nothing to project); no recent-window data specifically
// (rare — would need real games but none within the window, i.e. a bye
// mid-window) -> falls back to the season rate, same "no data yet, no
// adjustment" posture as the rest of this module.
export function projectFromUsageTrend({ seasonUsageRate, recentUsageRate, efficiency, usageTrendWeight = 0 }) {
  if (!seasonUsageRate || efficiency == null) return null;
  const recentAvg = recentUsageRate ? recentUsageRate.avgPerGame : seasonUsageRate.avgPerGame;
  const blendedUsage = seasonUsageRate.avgPerGame * (1 - usageTrendWeight) + recentAvg * usageTrendWeight;
  return { projected: round1(blendedUsage * efficiency), blendedUsage: round1(blendedUsage) };
}
