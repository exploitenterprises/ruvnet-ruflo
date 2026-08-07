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
// Receiving yards/receptions split the opponent-allowed calculation by
// receiver position (WR vs. TE — nflverse's NGS receiving file only ever
// has those two positions, confirmed live, no RB rows at all) instead of
// lumping every receiver together — the hypothesis being that a defense
// tough on WRs but leaky on TEs (or vice versa) washes out to a misleading
// "average" rate otherwise. DEFAULT_PRIOR_GAMES (shrinkage toward league
// average, to cover the smaller per-position samples splitting creates)
// was grid-searched alongside matchupWeight to test that hypothesis
// properly. Honest result: it didn't work — searched 186 combos per
// category (matchupWeight 0-1.5, priorGames 0-32) and NONE beat the naive
// own-rate-only baseline for either category. The position-split
// machinery below is real, tested, and stays (useful infrastructure, and
// the position data is genuinely more precise even if this particular use
// of it didn't pay off), but DEFAULT_MATCHUP_WEIGHTS still lands both
// receiving categories at 0 — same conclusion as before the split, just
// more thoroughly confirmed. See reports/backtest-player-props-2025-08-06.md's
// "Position split" section for the full search.
//
// Honest scope limit: no historical player-prop market lines are backtested
// against here — The Odds API only carries CURRENT/upcoming lines, and this
// project doesn't have a historical player-prop odds archive. This backtest
// validates projection accuracy against real outcomes (MAE/bias), not
// against a market — see the report for what that does and doesn't tell you.
//
// Fetching (buildPlayerPropsGames) is split from scoring
// (scorePlayerPropsGames) so playerPropsTuneWeight.js can grid-search each
// category's matchupWeight AND priorGames by re-running projectPlayerStat's
// cheap pure computation against already-fetched games, instead of
// re-fetching per candidate combo. The RAW (unshrunk) opponent-allowed rate
// is what gets cached per game; shrinkage (like the matchup blend) is
// applied at scoring time, not baked in at fetch time.

import { fetchNgsPassing, fetchNgsRushing, fetchNgsReceiving, fetchPbp } from './providers/nflverseProvider.js';
import {
  buildOpponentSchedule, aggregatePlayerRateThroughWeek, computeDefenseAllowedPerGame,
  leagueAverageAllowedPerGame, shrinkRate, projectPlayerStat,
} from './analysis/playerProps.js';

// Per-category matchupWeight, tuned against real 2024+2025 outcomes by
// playerPropsTuneWeight.js — see reports/backtest-player-props-2025-08-06.md's
// "Weight tuning" section for the search and the honest result: receiving
// yards and receptions found NO opponent-defense signal worth keeping at
// all — MAE-optimal is 0 even after the position split + shrinkage search
// below (186 combos tested per category, none beat the naive baseline) —
// while passing/rushing yards found a small partial adjustment helps
// marginally.
export const DEFAULT_MATCHUP_WEIGHTS = { passYards: 0.25, rushYards: 0.1, receivingYards: 0, receptions: 0 };
// Shrinkage strength (games worth of league-average prior) per category.
// 0 everywhere — the position-split receiving categories were searched at
// priorGames up to 32 alongside matchupWeight and found no combination
// that helped, so there's nothing for shrinkage to rescue at matchupWeight
// 0 (it only has an effect when matchupWeight > 0).
export const DEFAULT_PRIOR_GAMES = { passYards: 0, rushYards: 0, receivingYards: 0, receptions: 0 };

const CATEGORY_CONFIG = {
  passYards: { statField: 'pass_yards', eligible: (r) => Number(r.attempts) >= 10, positionSplit: false },
  rushYards: { statField: 'rush_yards', eligible: (r) => Number(r.rush_attempts) >= 5, positionSplit: false },
  receivingYards: { statField: 'yards', eligible: (r) => Number(r.targets) >= 2, positionSplit: true },
  receptions: { statField: 'receptions', eligible: (r) => Number(r.targets) >= 2, positionSplit: true },
};

// Fetches and reconstructs everything a full season's worth of
// projectPlayerStat calls need — real, point-in-time inputs plus the real
// outcome — without calling projectPlayerStat itself. Returns
// { passYards: [...], rushYards: [...], receivingYards: [...], receptions: [...] },
// each entry carrying the RAW (unshrunk) opponent-allowed rate + count.
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
      const { statField, eligible, positionSplit } = CATEGORY_CONFIG[category];
      const rows = rowsByCategory[category];
      const thisWeekRows = rows.filter((r) => r.week === week && eligible(r));
      if (thisWeekRows.length === 0) continue;

      // Allowed-per-game map(s): one shared map, or one per receiver
      // position (WR/TE) when positionSplit is on — computed lazily per
      // group actually needed this week, cached so multiple players of the
      // same position/week reuse the same computation.
      const allowedByGroup = {};
      function allowedMapFor(positionGroup) {
        const key = positionGroup ?? '_all';
        if (!(key in allowedByGroup)) {
          const groupRows = positionGroup ? rows.filter((r) => r.player_position === positionGroup) : rows;
          const raw = computeDefenseAllowedPerGame(groupRows, statField, schedule, week - 1);
          allowedByGroup[key] = { raw, leagueAvg: leagueAverageAllowedPerGame(raw) };
        }
        return allowedByGroup[key];
      }

      for (const r of thisWeekRows) {
        const playerRate = aggregatePlayerRateThroughWeek(rows, r.player_gsis_id, statField, week - 1);
        if (!playerRate || playerRate.gamesPlayed < minGamesPlayed) continue;
        const opponent = schedule[week]?.[r.team_abbr];
        const { raw, leagueAvg } = allowedMapFor(positionSplit ? r.player_position : null);

        games[category].push({
          season, week, player: r.player_display_name, team: r.team_abbr, opponent, position: r.player_position,
          playerRate,
          opponentAllowedRaw: opponent != null ? (raw[opponent] ?? null) : null,
          leagueAvgAllowedPerGame: leagueAvg,
          actual: Number(r[statField]) || 0,
        });
      }
    }
  }
  return games;
}

// Scores one category's already-fetched games with projectPlayerStat at a
// given matchupWeight (default 1, the original full-ratio behavior) and
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
      season: g.season, week: g.week, player: g.player, team: g.team, opponent: g.opponent, position: g.position,
      projected: proj.projected, actual: g.actual, matchupFactor: proj.matchupFactor,
      naiveProjected: round1(g.playerRate.avgPerGame), gamesOfHistory: g.playerRate.gamesPlayed,
    });
  }
  return predictions;
}

// Scores every category — `matchupWeights`/`priorGamesMap` are optional
// { category: value } maps, falling back to DEFAULT_MATCHUP_WEIGHTS/
// DEFAULT_PRIOR_GAMES (the tuned values) per category for any category not
// specified.
export function scorePlayerPropsGames(games, matchupWeights = {}, priorGamesMap = {}) {
  const predictions = {};
  for (const category of Object.keys(games)) {
    predictions[category] = scoreCategoryGames(
      games[category],
      matchupWeights[category] ?? DEFAULT_MATCHUP_WEIGHTS[category] ?? 1,
      priorGamesMap[category] ?? DEFAULT_PRIOR_GAMES[category] ?? 0,
    );
  }
  return predictions;
}

export async function backtestPlayerProps(season, { weeks, minGamesPlayed, matchupWeights, priorGamesMap } = {}) {
  const games = await buildPlayerPropsGames(season, { weeks, minGamesPlayed });
  return scorePlayerPropsGames(games, matchupWeights, priorGamesMap);
}

function round1(v) { return Math.round(v * 10) / 10; }
