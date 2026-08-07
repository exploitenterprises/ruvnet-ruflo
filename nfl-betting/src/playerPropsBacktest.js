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

import { fetchNgsPassing, fetchNgsRushing, fetchNgsReceiving, fetchPbp } from './providers/nflverseProvider.js';
import {
  buildOpponentSchedule, aggregatePlayerRateThroughWeek, computeDefenseAllowedPerGame,
  leagueAverageAllowedPerGame, projectPlayerStat,
} from './analysis/playerProps.js';

const CATEGORY_CONFIG = {
  passYards: { statField: 'pass_yards', eligible: (r) => Number(r.attempts) >= 10 },
  rushYards: { statField: 'rush_yards', eligible: (r) => Number(r.rush_attempts) >= 5 },
  receivingYards: { statField: 'yards', eligible: (r) => Number(r.targets) >= 2 },
  receptions: { statField: 'receptions', eligible: (r) => Number(r.targets) >= 2 },
};

export async function backtestPlayerProps(season, { weeks = Array.from({ length: 18 }, (_, i) => i + 1), minGamesPlayed = 3 } = {}) {
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

  const predictions = { passYards: [], rushYards: [], receivingYards: [], receptions: [] };

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
        const proj = projectPlayerStat({
          playerRate,
          opponentAllowedPerGame: opponent != null ? allowedPerGame[opponent] : null,
          leagueAvgAllowedPerGame: leagueAvgAllowed,
        });
        if (!proj) continue;

        predictions[category].push({
          season, week, player: r.player_display_name, team: r.team_abbr, opponent,
          projected: proj.projected, actual: Number(r[statField]) || 0,
          matchupFactor: proj.matchupFactor, gamesOfHistory: playerRate.gamesPlayed,
        });
      }
    }
  }
  return predictions;
}
