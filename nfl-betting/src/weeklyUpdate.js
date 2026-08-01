import { STADIUMS } from './data/stadiums.js';
import { TEAMS } from './data/teams.js';
import { computeLeagueAverages } from './analysis/leagueAverages.js';
import { projectGame } from './analysis/matchupEngine.js';
import { findValueBets } from './analysis/valueFinder.js';
import { simulateSeason, findFuturesValue } from './analysis/futures.js';
import { loadRatings, saveRatings, seedSeasonRatings, applyResults } from './ratingsStore.js';
import { renderWeeklyMarkdown } from './report.js';
import { loadCoachNotes } from './analysis/schemeTendencies.js';
import * as mock from './providers/mockData.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COACH_NOTES_PATH = path.join(__dirname, '..', 'data', 'coach-notes.json');

// Orchestrates one weekly refresh: pull latest results/stats/schedule/weather/
// odds, roll the power ratings forward, project every game on the slate,
// scan for value against the books, and re-run the futures simulation.
// This is the single entry point the CLI calls — `source: 'mock'` runs fully
// offline/deterministic (for demos, CI, and this repo's test suite);
// `source: 'live'` wires in the real providers (needs network + ODDS_API_KEY).
export async function runWeeklyUpdate({ season, week, source = 'mock' }) {
  const generatedAt = new Date().toISOString();

  if (source === 'mock') return runWithMockData({ season, week, generatedAt });
  return runWithLiveData({ season, week, generatedAt });
}

async function runWithMockData({ season, week, generatedAt }) {
  const seasonStats = mock.generateMockSeasonStats();

  let ratings = await loadRatings();
  if (!ratings) {
    ratings = seedSeasonRatings(seasonStats);
    await saveRatings(ratings);
  }

  const slate = mock.generateMockWeekSlate(week);
  const leagueAvg = computeLeagueAverages(Object.values(seasonStats));
  const coachNotes = await loadCoachNotes(COACH_NOTES_PATH);

  const projections = slate.map((g) => projectGame({
    home: { abbr: g.home, stats: seasonStats[g.home], rating: ratings[g.home] },
    away: { abbr: g.away, stats: seasonStats[g.away], rating: ratings[g.away] },
    leagueAvg,
    weather: STADIUMS[g.home].roof === 'outdoor'
      ? { isDome: false, tempF: 45, windMph: 12, precipProbPct: 20 } // placeholder conditions in mock mode
      : { isDome: true },
    neutralSite: g.neutralSite,
    coachNotes,
  }));

  const lines = mock.generateMockGameLines(slate);
  const valueBets = projections.flatMap((p) => findValueBets(p, lines.filter((l) => l.gameId === `${p.away}@${p.home}`)));

  const teamsForSim = Object.fromEntries(Object.keys(TEAMS).map((abbr) => [abbr, { rating: ratings[abbr], currentWins: 0, currentLosses: 0, currentTies: 0 }]));
  const remainingSchedule = mock.generateMockRemainingSchedule(17 - week);
  const simResults = simulateSeason({ teams: teamsForSim, remainingSchedule, iterations: 2000 });
  const divisionOdds = mock.generateMockFutures('division-winner');
  const divisionModelProbs = Object.fromEntries(Object.entries(simResults).map(([abbr, r]) => [abbr, r.divisionWinPct]));
  const futuresValue = findFuturesValue(divisionModelProbs, divisionOdds, 'division-winner');

  const markdown = renderWeeklyMarkdown({ season, week, source: 'mock (synthetic fixtures — see providers/mockData.js)', projections, valueBets, futuresValue, generatedAt });
  return { season, week, source: 'mock', generatedAt, projections, valueBets, futuresValue, markdown };
}

async function runWithLiveData({ season, week, generatedAt }) {
  const statsProvider = await import('./providers/statsProvider.js');
  const weatherProvider = await import('./providers/weatherProvider.js');
  const oddsProvider = await import('./providers/oddsProvider.js');

  const teamsIndex = await statsProvider.fetchTeamsIndex();
  const seasonStats = {};
  for (const t of teamsIndex) {
    const raw = await statsProvider.fetchTeamSeasonStats(season, t.id);
    seasonStats[t.abbr] = mapEspnStatsToModel(t.abbr, raw);
  }

  let ratings = await loadRatings();
  if (!ratings) {
    ratings = seedSeasonRatings(seasonStats);
  }
  if (week > 1) {
    const priorWeekResults = await statsProvider.fetchWeekScoreboard(season, week - 1);
    const completed = priorWeekResults.filter((g) => g.completed);
    ratings = applyResults(ratings, completed);
  }
  await saveRatings(ratings);

  const slate = await statsProvider.fetchWeekScoreboard(season, week);
  const leagueAvg = computeLeagueAverages(Object.values(seasonStats));
  const coachNotes = await loadCoachNotes(COACH_NOTES_PATH);

  const lines = await oddsProvider.fetchGameLines();

  const projections = [];
  for (const g of slate) {
    const stadium = STADIUMS[g.home.abbr];
    let weather = { isDome: true };
    if (stadium?.roof === 'outdoor') {
      try {
        const wx = await weatherProvider.fetchGameWeather({ lat: stadium.lat, lon: stadium.lon, kickoffIso: g.date });
        weather = wx;
      } catch (err) {
        weather = { isDome: false, note: `weather fetch failed: ${err.message}` };
      }
    }
    projections.push(projectGame({
      home: { abbr: g.home.abbr, stats: seasonStats[g.home.abbr], rating: ratings[g.home.abbr] },
      away: { abbr: g.away.abbr, stats: seasonStats[g.away.abbr], rating: ratings[g.away.abbr] },
      leagueAvg,
      weather,
      neutralSite: g.neutralSite,
      coachNotes,
    }));
  }

  const valueBets = projections.flatMap((p) => findValueBets(p, lines.filter((l) => l.gameId === findGameId(slate, p))));

  const teamsForSim = Object.fromEntries(Object.keys(TEAMS).map((abbr) => [abbr, { rating: ratings[abbr], currentWins: 0, currentLosses: 0, currentTies: 0 }]));
  // Live mode: the remaining schedule and current W-L records should be
  // pulled from statsProvider (full-season scoreboard fetch across weeks);
  // left as a documented extension point since it requires 18 additional
  // scoreboard calls this repo's test suite should not make on every run.
  const futuresValue = [];

  const markdown = renderWeeklyMarkdown({ season, week, source: 'live (ESPN + The Odds API)', projections, valueBets, futuresValue, generatedAt });
  return { season, week, source: 'live', generatedAt, projections, valueBets, futuresValue, markdown };
}

function findGameId(slate, projection) {
  const g = slate.find((x) => x.home.abbr === projection.home && x.away.abbr === projection.away);
  return g?.id;
}

// ESPN's team-statistics field names aren't stable across categories; this is
// a best-effort mapping documented for maintainers to adjust as the schema drifts.
function mapEspnStatsToModel(abbr, raw) {
  return {
    abbr,
    gamesPlayed: raw.gamesPlayed ?? 17,
    pointsForPerGame: raw.avgPointsFor ?? raw.totalPointsPerGame ?? 21,
    pointsAgainstPerGame: raw.avgPointsAgainst ?? raw.totalPointsAgainstPerGame ?? 21,
    homePointsForPerGame: raw.avgPointsFor ?? 21,
    homePointsAgainstPerGame: raw.avgPointsAgainst ?? 21,
    awayPointsForPerGame: raw.avgPointsFor ?? 21,
    awayPointsAgainstPerGame: raw.avgPointsAgainst ?? 21,
    passYardsPerGame: raw.netPassingYardsPerGame ?? 220,
    rushYardsPerGame: raw.rushingYardsPerGame ?? 110,
    yardsPerPlay: raw.yardsPerPlay ?? 5.4,
    playsPerGame: raw.totalOffensivePlays ? raw.totalOffensivePlays / (raw.gamesPlayed ?? 17) : 64,
    thirdDownPct: raw.thirdDownConvPct ?? 39,
    redZoneTdPct: raw.redzoneTouchdownPct ?? 58,
    sackRate: raw.sacks ? (raw.sacks / (raw.gamesPlayed ?? 17)) : 2.5,
    sackRateAllowed: raw.sacksAllowed ? (raw.sacksAllowed / (raw.gamesPlayed ?? 17)) : 2.5,
    fourthDownAttemptRate: raw.fourthDownAttempts ? (raw.fourthDownAttempts / (raw.gamesPlayed ?? 17)) : 1.5,
    priorSeasonPointDiffPerGame: (raw.avgPointsFor ?? 21) - (raw.avgPointsAgainst ?? 21),
  };
}
