// Backtests the player-props projection model (analysis/playerProps.js)
// against real NFL outcomes — point-in-time, no lookahead: every
// projection uses only games through week N-1.
//
// Two different models depending on category, because two different
// hypotheses were tested and only one survived backtesting:
//
// - Passing/rushing yards use the opponent-defense-adjusted model
//   (projectPlayerStat): player's own rate blended toward an
//   opponent-allowed-rate adjustment. Real, if modest, signal survived
//   tuning here (matchupWeight 0.25/0.1 — see DEFAULT_MATCHUP_WEIGHTS).
// - Receiving yards/receptions use a usage-trend model instead
//   (projectFromUsageTrend): targets x efficiency (yards-per-target or
//   catch-rate), with targets blended toward a recent-window rate. Built
//   after the opponent-adjustment model — including a position-split
//   variant (WR vs. TE) with shrinkage — was grid-searched exhaustively
//   for these two categories and found NO usable signal at all (0 of 186
//   weight/shrinkage combos beat the naive baseline). See
//   reports/backtest-player-props-2025-08-06.md for both searches and the
//   position-split negative result specifically.
//
// Eligibility filters (real usage thresholds, not arbitrary) decide which
// of a week's games are meaningful enough to test against — a QB with 2
// mop-up attempts or a WR with 0 targets isn't a fair test of "did the
// projection call this player's real workload," it's noise.
// `minGamesPlayed` similarly requires real trailing history (default 3)
// before trusting a player's own rate.
//
// Honest scope limit: no historical player-prop market lines are backtested
// against here — The Odds API only carries CURRENT/upcoming lines, and this
// project doesn't have a historical player-prop odds archive. This backtest
// validates projection accuracy against real outcomes (MAE/bias), not
// against a market — see the report for what that does and doesn't tell you.
//
// Fetching (buildPlayerPropsGames) is split from scoring
// (scorePlayerPropsGames) so playerPropsTuneWeight.js can grid-search
// weights/windows by re-running the cheap pure projection functions
// against already-fetched games, instead of re-fetching per candidate.

import { fetchNgsPassing, fetchNgsRushing, fetchNgsReceiving, fetchPbp } from './providers/nflverseProvider.js';
import {
  buildOpponentSchedule, aggregatePlayerRateThroughWeek, computeDefenseAllowedPerGame,
  leagueAverageAllowedPerGame, shrinkRate, projectPlayerStat,
  aggregatePlayerRateOverWindow, computePlayerEfficiency, projectFromUsageTrend,
} from './analysis/playerProps.js';

// Opponent-defense-adjusted categories — see playerPropsTuneWeight.js's
// "Weight tuning" search for how these were found.
export const DEFAULT_MATCHUP_WEIGHTS = { passYards: 0.25, rushYards: 0.1 };
export const DEFAULT_PRIOR_GAMES = { passYards: 0, rushYards: 0 };
const MATCHUP_CATEGORY_CONFIG = {
  passYards: { statField: 'pass_yards', eligible: (r) => Number(r.attempts) >= 10 },
  rushYards: { statField: 'rush_yards', eligible: (r) => Number(r.rush_attempts) >= 5 },
};

// Usage-trend categories — see playerPropsTuneWeight.js's "Usage trend"
// search for how these were found.
export const DEFAULT_USAGE_TREND_WEIGHTS = { receivingYards: 0, receptions: 0 };
export const DEFAULT_WINDOW_GAMES = { receivingYards: 3, receptions: 3 };
const USAGE_TREND_CATEGORY_CONFIG = {
  receivingYards: { statField: 'yards', usageField: 'targets', eligible: (r) => Number(r.targets) >= 2 },
  receptions: { statField: 'receptions', usageField: 'targets', eligible: (r) => Number(r.targets) >= 2 },
};

// Fetches and reconstructs everything a full season's worth of projections
// need — real, point-in-time inputs plus the real outcome — without
// scoring anything yet. Returns
// { passYards: [...], rushYards: [...], receivingYards: [...], receptions: [...] }.
export async function buildPlayerPropsGames(season, { weeks = Array.from({ length: 18 }, (_, i) => i + 1), minGamesPlayed = 3 } = {}) {
  const [allPassing, allRushing, allReceiving, pbpRows] = await Promise.all([
    fetchNgsPassing(), fetchNgsRushing(), fetchNgsReceiving(), fetchPbp(season),
  ]);
  const inSeason = (r) => r.season === season && r.season_type === 'REG';
  const rowsByCategory = {
    passYards: allPassing.filter(inSeason),
    rushYards: allRushing.filter(inSeason),
    receivingYards: allReceiving.filter(inSeason),
    receptions: allReceiving.filter(inSeason),
  };
  const schedule = buildOpponentSchedule(pbpRows.map((r) => r.game_id));

  const games = { passYards: [], rushYards: [], receivingYards: [], receptions: [] };

  for (const week of weeks) {
    if (week === 1) continue; // no trailing history yet — nothing to project from

    for (const category of Object.keys(MATCHUP_CATEGORY_CONFIG)) {
      const { statField, eligible } = MATCHUP_CATEGORY_CONFIG[category];
      const rows = rowsByCategory[category];
      const thisWeekRows = rows.filter((r) => r.week === week && eligible(r));
      if (thisWeekRows.length === 0) continue;

      const rawAllowed = computeDefenseAllowedPerGame(rows, statField, schedule, week - 1);
      const leagueAvg = leagueAverageAllowedPerGame(rawAllowed);

      for (const r of thisWeekRows) {
        const playerRate = aggregatePlayerRateThroughWeek(rows, r.player_gsis_id, statField, week - 1);
        if (!playerRate || playerRate.gamesPlayed < minGamesPlayed) continue;
        const opponent = schedule[week]?.[r.team_abbr];

        games[category].push({
          season, week, player: r.player_display_name, team: r.team_abbr, opponent,
          playerRate,
          opponentAllowedRaw: opponent != null ? (rawAllowed[opponent] ?? null) : null,
          leagueAvgAllowedPerGame: leagueAvg,
          actual: Number(r[statField]) || 0,
        });
      }
    }

    for (const category of Object.keys(USAGE_TREND_CATEGORY_CONFIG)) {
      const { statField, usageField, eligible } = USAGE_TREND_CATEGORY_CONFIG[category];
      const rows = rowsByCategory[category];
      const thisWeekRows = rows.filter((r) => r.week === week && eligible(r));
      if (thisWeekRows.length === 0) continue;

      for (const r of thisWeekRows) {
        const seasonUsageRate = aggregatePlayerRateThroughWeek(rows, r.player_gsis_id, usageField, week - 1);
        if (!seasonUsageRate || seasonUsageRate.gamesPlayed < minGamesPlayed) continue;
        const efficiency = computePlayerEfficiency(rows, r.player_gsis_id, statField, usageField, week - 1);

        games[category].push({
          season, week, player: r.player_display_name, team: r.team_abbr, position: r.player_position,
          rows, playerId: r.player_gsis_id, throughWeek: week - 1, usageField,
          seasonUsageRate, efficiency,
          actual: Number(r[statField]) || 0,
        });
      }
    }
  }
  return games;
}

// Scores one opponent-adjusted category's already-fetched games at a given
// matchupWeight (default 1, the original full-ratio behavior) and
// priorGames shrinkage strength (default 0, no shrinkage).
export function scoreCategoryGames(games, matchupWeight = 1, priorGames = 0) {
  const predictions = [];
  for (const g of games) {
    const shrunkOpponentAllowed = g.opponentAllowedRaw
      ? shrinkRate(g.opponentAllowedRaw.avgAllowedPerGame, g.opponentAllowedRaw.games, g.leagueAvgAllowedPerGame, priorGames)
      : null;
    const proj = projectPlayerStat({
      playerRate: g.playerRate, opponentAllowedPerGame: shrunkOpponentAllowed,
      leagueAvgAllowedPerGame: g.leagueAvgAllowedPerGame, matchupWeight,
    });
    if (!proj) continue;
    predictions.push({
      season: g.season, week: g.week, player: g.player, team: g.team, opponent: g.opponent,
      projected: proj.projected, actual: g.actual, matchupFactor: proj.matchupFactor,
      naiveProjected: round1(g.playerRate.avgPerGame), gamesOfHistory: g.playerRate.gamesPlayed,
    });
  }
  return predictions;
}

// Scores one usage-trend category's already-fetched games at a given
// usageTrendWeight (default 0 — pure season-long usage, no trend) and
// windowGames (how many recent games count as "recent" when the weight is
// above 0).
export function scoreUsageTrendGames(games, usageTrendWeight = 0, windowGames = 3) {
  const predictions = [];
  for (const g of games) {
    const recentUsageRate = usageTrendWeight > 0
      ? aggregatePlayerRateOverWindow(g.rows, g.playerId, g.usageField, g.throughWeek, windowGames)
      : null;
    const proj = projectFromUsageTrend({ seasonUsageRate: g.seasonUsageRate, recentUsageRate, efficiency: g.efficiency, usageTrendWeight });
    if (!proj) continue;
    predictions.push({
      season: g.season, week: g.week, player: g.player, team: g.team,
      projected: proj.projected, actual: g.actual, blendedUsage: proj.blendedUsage,
      naiveProjected: g.efficiency != null ? round1(g.seasonUsageRate.avgPerGame * g.efficiency) : null,
    });
  }
  return predictions;
}

// Scores every category — all four option maps are optional { category: value },
// falling back to this file's tuned DEFAULT_* constants for any category not
// specified.
export function scorePlayerPropsGames(games, {
  matchupWeights = {}, priorGamesMap = {}, usageTrendWeights = {}, windowGamesMap = {},
} = {}) {
  const predictions = {};
  for (const category of Object.keys(MATCHUP_CATEGORY_CONFIG)) {
    predictions[category] = scoreCategoryGames(
      games[category],
      matchupWeights[category] ?? DEFAULT_MATCHUP_WEIGHTS[category] ?? 1,
      priorGamesMap[category] ?? DEFAULT_PRIOR_GAMES[category] ?? 0,
    );
  }
  for (const category of Object.keys(USAGE_TREND_CATEGORY_CONFIG)) {
    predictions[category] = scoreUsageTrendGames(
      games[category],
      usageTrendWeights[category] ?? DEFAULT_USAGE_TREND_WEIGHTS[category] ?? 0,
      windowGamesMap[category] ?? DEFAULT_WINDOW_GAMES[category] ?? 3,
    );
  }
  return predictions;
}

export async function backtestPlayerProps(season, { weeks, minGamesPlayed, ...scoreOpts } = {}) {
  const games = await buildPlayerPropsGames(season, { weeks, minGamesPlayed });
  return scorePlayerPropsGames(games, scoreOpts);
}

function round1(v) { return Math.round(v * 10) / 10; }
