// Backtests the FULL matchup-engine blend (season-to-date box-score stats +
// Elo + EPA/play) for a completed NFL season — not just the Elo signal
// (see nflEloBacktest.js / reports/backtest-elo-2025-08-06.md for why that
// one was Elo-only: ESPN's team-statistics endpoint is always an "as of
// query time" aggregate, confirmed live to silently ignore a `week` query
// param, so it can't be used for a no-lookahead backtest of the stats half
// of the blend).
//
// The unlock: statsProvider.js's fetchGameBoxscore pulls each individual
// completed game's real boxscore, and analysis/pointInTimeStats.js
// aggregates those into "stats as of week N" ourselves — built only from
// games that had actually been played by the cutoff week, exactly the same
// no-lookahead discipline nflEloBacktest.js already applies to ratings.
// EPA needs no such reconstruction: teamEpa.js's computeTeamEpaSplits
// already takes a `throughWeek` cutoff directly against nflverse's
// play-by-play (that data is inherently point-in-time — a play's epa/success
// value doesn't change after the fact).
//
// Weather is deliberately OMITTED here, not faked: Open-Meteo (this
// project's weather provider) is a forecast API with no deep historical
// archive wired up, so there's no honest way to reconstruct "what the
// forecast looked like before kickoff" for a game that already happened.
// Every projection below passes `{ isDome: true }` (no weather adjustment)
// for every game, dome or not — a deliberate, documented simplification,
// not a silent gap.
//
// Boxscore fetches are cached to disk (data/cache/nfl-boxscores-<season>.json,
// gitignored) since a full season is ~272 individual API calls — expensive
// to redo on every run, cheap to keep once fetched (a completed game's
// boxscore never changes).

import { fetchWeekScoreboard, fetchTeamsIndex, fetchTeamSeasonStats, fetchGameBoxscore } from './providers/statsProvider.js';
import { mapEspnStatsToModel } from './weeklyUpdate.js';
import { seedSeasonRatings, applyResults } from './ratingsStore.js';
import { projectGame } from './analysis/matchupEngine.js';
import { computeLeagueAverages } from './analysis/leagueAverages.js';
import { aggregateTeamStatsThroughWeek } from './analysis/pointInTimeStats.js';
import { computeTeamEpaSplits } from './analysis/teamEpa.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');

async function loadBoxscoreCache(season) {
  try {
    return JSON.parse(await readFile(path.join(CACHE_DIR, `nfl-boxscores-${season}.json`), 'utf8'));
  } catch {
    return {};
  }
}

async function saveBoxscoreCache(season, cache) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path.join(CACHE_DIR, `nfl-boxscores-${season}.json`), JSON.stringify(cache));
}

export async function backtestNflFullModel(season, { weeks = Array.from({ length: 18 }, (_, i) => i + 1), onWeekDone } = {}) {
  const teamsIndex = await fetchTeamsIndex();

  const priorSeasonStats = {};
  for (const t of teamsIndex) {
    try {
      const raw = await fetchTeamSeasonStats(season - 1, t.id);
      priorSeasonStats[t.abbr] = mapEspnStatsToModel(t.abbr, raw);
    } catch {
      // No fetchable prior season (relocation/expansion) — seedSeasonRatings' own
      // fallback covers Elo; pointInTimeStats' fallbackProfile covers week-1 stats.
    }
  }
  let ratings = seedSeasonRatings(priorSeasonStats);

  let pbpRows = [];
  try {
    const nflverseProvider = await import('./providers/nflverseProvider.js');
    pbpRows = await nflverseProvider.fetchPbp(season);
  } catch {
    pbpRows = []; // degrade to no-EPA blend, same posture as the live pipeline
  }

  const boxscoreCache = await loadBoxscoreCache(season);
  const gameRecords = []; // accumulates as weeks complete — the point-in-time stat source
  const predictions = [];

  for (const week of weeks) {
    const slate = await fetchWeekScoreboard(season, week);
    const completed = slate.filter((g) => g.completed && g.home.score != null && g.away.score != null);
    if (completed.length === 0) continue;

    // Point-in-time inputs: only games strictly BEFORE this week feed the
    // stats/EPA used to predict it — gameRecords/ratings/pbp haven't been
    // updated with this week's results yet at this point in the loop.
    const seasonStatsByTeam = {};
    for (const t of teamsIndex) seasonStatsByTeam[t.abbr] = aggregateTeamStatsThroughWeek(gameRecords, t.abbr, week - 1);
    const leagueAvg = computeLeagueAverages(Object.values(seasonStatsByTeam));
    const epaSplitsByTeam = pbpRows.length ? computeTeamEpaSplits(pbpRows, { throughWeek: week - 1 }) : {};

    for (const g of completed) {
      const homeRating = ratings[g.home.abbr];
      const awayRating = ratings[g.away.abbr];
      if (homeRating == null || awayRating == null) continue;

      const proj = projectGame({
        home: { abbr: g.home.abbr, stats: seasonStatsByTeam[g.home.abbr], rating: homeRating },
        away: { abbr: g.away.abbr, stats: seasonStatsByTeam[g.away.abbr], rating: awayRating },
        leagueAvg,
        weather: { isDome: true }, // see file header — no honest historical-weather source
        neutralSite: g.neutralSite,
        epaSplits: { home: epaSplitsByTeam[g.home.abbr], away: epaSplitsByTeam[g.away.abbr] },
      });

      predictions.push({
        season, week, homeTeam: g.home.abbr, awayTeam: g.away.abbr,
        homeWinProb: proj.homeWinProb, homeWon: g.home.score > g.away.score,
        projectedSpread: proj.projectedSpread, actualMargin: g.home.score - g.away.score,
        projectedTotal: proj.projectedTotal, actualTotal: g.home.score + g.away.score,
      });
    }

    // Now pull this week's boxscores (cached) to extend gameRecords for future weeks.
    for (const g of completed) {
      const key = String(g.id);
      if (!boxscoreCache[key]) {
        boxscoreCache[key] = await fetchGameBoxscore(g.id);
      }
      const bs = boxscoreCache[key];
      if (bs.home && bs.away) {
        gameRecords.push({
          week,
          home: { abbr: g.home.abbr, score: g.home.score, stats: bs.home.stats },
          away: { abbr: g.away.abbr, score: g.away.score, stats: bs.away.stats },
        });
      }
    }
    await saveBoxscoreCache(season, boxscoreCache);

    ratings = applyResults(ratings, completed);
    onWeekDone?.(week, completed.length);
  }

  return predictions;
}
