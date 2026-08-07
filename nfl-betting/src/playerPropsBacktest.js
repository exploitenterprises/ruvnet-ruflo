// Backtests the player-props projection model (analysis/playerProps.js)
// against real NFL outcomes — point-in-time, no lookahead: each week N
// projection uses only games through week N-1 for both the player's own
// rate and the opponent-defense-allowed rate.
//
// Four categories, matching what real prop markets actually offer: passing
// yards, rushing yards, receiving yards, receptions. Eligibility filters
// (real usage thresholds, not arbitrary) decide which of a week's games are
// meaningful enough to test against — a QB with 2 mop-up attempts or a WR
// with 0 targets isn't a fair test of "did the projection call this
// player's real workload," it's noise. `minGamesPlayed` similarly requires
// real trailing history (default 3) before trusting a player's own rate.
//
// Honest scope limit: no historical player-prop market lines are backtested
// against here — The Odds API only carries CURRENT/upcoming lines, and this
// project doesn't have a historical player-prop odds archive. This backtest
// validates projection accuracy against real outcomes (MAE/bias), not
// against a market — see the report for what that does and doesn't tell you.
//
// Fetching (buildPlayerPropsGames) is split from scoring
// (scorePlayerPropsGames) so playerPropsTuneWeight.js can grid-search each
// category's matchupWeight (analysis/playerProps.js's blend between the
// naive own-rate and the full opponent-adjusted ratio) by re-running
// projectPlayerStat's cheap pure computation against already-fetched games,
// instead of re-fetching per candidate weight.

import { fetchNgsPassing, fetchNgsRushing, fetchNgsReceiving, fetchPbp } from './providers/nflverseProvider.js';
import {
  buildOpponentSchedule, aggregatePlayerRateThroughWeek, computeDefenseAllowedPerGame,
  leagueAverageAllowedPerGame, projectPlayerStat,
} from './analysis/playerProps.js';

// Per-category matchupWeight, tuned against real 2024+2025 outcomes by
// playerPropsTuneWeight.js — see reports/backtest-player-props-2025-08-06.md's
// "Weight tuning" section for the search and the honest result: receiving
// yards and receptions found NO opponent-defense signal worth keeping at
// all (MAE-optimal weight is exactly 0 for both — the naive own-rate-only
// projection wins outright), while passing/rushing yards found a small
// partial adjustment helps marginally, well short of the original full
// ratio (weight 1). These are the model's real defaults now, not 1 for
// every category.
export const DEFAULT_MATCHUP_WEIGHTS = { passYards: 0.25, rushYards: 0.1, receivingYards: 0, receptions: 0 };

const CATEGORY_CONFIG = {
  passYards: { statField: 'pass_yards', eligible: (r) => Number(r.attempts) >= 10 },
  rushYards: { statField: 'rush_yards', eligible: (r) => Number(r.rush_attempts) >= 5 },
  receivingYards: { statField: 'yards', eligible: (r) => Number(r.targets) >= 2 },
  receptions: { statField: 'receptions', eligible: (r) => Number(r.targets) >= 2 },
};

// Fetches and reconstructs everything a full season's worth of
// projectPlayerStat calls need — real, point-in-time inputs plus the real
// outcome — without calling projectPlayerStat itself. Returns
// { passYards: [...], rushYards: [...], receivingYards: [...], receptions: [...] },
// each entry { playerRate, opponentAllowedPerGame, leagueAvgAllowedPerGame, actual, ... }.
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
    for (const category of Object.keys(CATEGORY_CONFIG)) {
      const { statField, eligible } = CATEGORY_CONFIG[category];
      const rows = rowsByCategory[category];
      const thisWeekRows = rows.filter((r) => r.week === week && eligible(r));
      if (thisWeekRows.length === 0) continue;

      const allowedPerGame = computeDefenseAllowedPerGame(rows, statField, schedule, week - 1);
      const leagueAvgAllowed = leagueAverageAllowedPerGame(allowedPerGame);

      for (const r of thisWeekRows) {
        const playerRate = aggregatePlayerRateThroughWeek(rows, r.player_gsis_id, statField, week - 1);
        if (!playerRate || playerRate.gamesPlayed < minGamesPlayed) continue;
        const opponent = schedule[week]?.[r.team_abbr];

        games[category].push({
          season, week, player: r.player_display_name, team: r.team_abbr, opponent,
          playerRate,
          opponentAllowedPerGame: opponent != null ? allowedPerGame[opponent] : null,
          leagueAvgAllowedPerGame: leagueAvgAllowed,
          actual: Number(r[statField]) || 0,
        });
      }
    }
  }
  return games;
}

// Scores one category's already-fetched games with projectPlayerStat at a
// given matchupWeight (default 1 — the original full-ratio behavior).
export function scoreCategoryGames(games, matchupWeight = 1) {
  const predictions = [];
  for (const g of games) {
    const proj = projectPlayerStat({
      playerRate: g.playerRate, opponentAllowedPerGame: g.opponentAllowedPerGame,
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

// Scores every category — `matchupWeights` is an optional { category: weight }
// map, falling back to DEFAULT_MATCHUP_WEIGHTS (the tuned values) per
// category for any category not specified. Pass `{ passYards: 1, ... }`
// explicitly to reproduce the pre-tuning full-ratio behavior.
export function scorePlayerPropsGames(games, matchupWeights = {}) {
  const predictions = {};
  for (const category of Object.keys(games)) {
    predictions[category] = scoreCategoryGames(games[category], matchupWeights[category] ?? DEFAULT_MATCHUP_WEIGHTS[category] ?? 1);
  }
  return predictions;
}

export async function backtestPlayerProps(season, { weeks, minGamesPlayed, matchupWeights } = {}) {
  const games = await buildPlayerPropsGames(season, { weeks, minGamesPlayed });
  return scorePlayerPropsGames(games, matchupWeights);
}

function round1(v) { return Math.round(v * 10) / 10; }
